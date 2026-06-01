import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getBrowserActionPositionals, parseArgs, runCli } from "../../src/cli";

function makeHome(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "bc-operator-cli-"));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort(): Promise<number> {
	const server = createServer();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port;
			server.close(() => resolve(port));
		});
	});
}

async function killPid(pid: number | undefined): Promise<void> {
	if (!pid) return;
	try {
		process.kill(pid);
	} catch {
		return;
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await sleep(100);
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		/* already dead */
	}
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await sleep(100);
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
	}
}

async function removeHome(home: string): Promise<void> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			fs.rmSync(home, { recursive: true, force: true });
			return;
		} catch (error) {
			if (attempt === 9) throw error;
			await sleep(100);
		}
	}
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

function requestStatus(url: string, token: string): Promise<number> {
	const parsed = new URL(`${url}/api/capabilities`);
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname,
				headers: { authorization: `Bearer ${token}` },
			},
			(response) => {
				response.resume();
				response.on("end", () => resolve(response.statusCode ?? 0));
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

test("bc config env --json lists env-only knobs without leaking secrets", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const previousMcpMode = process.env.BROWSER_CONTROL_MCP_MODE;
	const previousBrowserbaseKey = process.env.BROWSERBASE_API_KEY;
	const previousCostPerToken = process.env.AI_AGENT_COST_PER_TOKEN;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		process.env.BROWSER_CONTROL_MCP_MODE = "lite";
		process.env.BROWSERBASE_API_KEY = "browserbase-secret";
		process.env.AI_AGENT_COST_PER_TOKEN = "0.0005";
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "config", "env", "--json"]);
		});
		const parsed = JSON.parse(output) as Array<{
			envVar: string;
			category: string;
			currentValue?: string;
		}>;
		assert.ok(parsed.some((entry) => entry.envVar === "BROWSER_CONTROL_MCP_MODE" && entry.category === "mcp"));
		assert.equal(parsed.find((entry) => entry.envVar === "AI_AGENT_COST_PER_TOKEN")?.currentValue, "0.0005");
		assert.ok(parsed.some((entry) => entry.envVar === "BROKER_RATE_LIMIT_MAX_REQUESTS"));
		assert.equal(parsed.find((entry) => entry.envVar === "BROWSERBASE_API_KEY")?.currentValue, "[redacted]");
		assert.doesNotMatch(output, /browserbase-secret/u);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		if (previousMcpMode === undefined) delete process.env.BROWSER_CONTROL_MCP_MODE;
		else process.env.BROWSER_CONTROL_MCP_MODE = previousMcpMode;
		if (previousBrowserbaseKey === undefined) delete process.env.BROWSERBASE_API_KEY;
		else process.env.BROWSERBASE_API_KEY = previousBrowserbaseKey;
		if (previousCostPerToken === undefined) delete process.env.AI_AGENT_COST_PER_TOKEN;
		else process.env.AI_AGENT_COST_PER_TOKEN = previousCostPerToken;
		await removeHome(home);
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

test("bc package record start stop draft materialize creates reusable package draft", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const startedOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"package",
				"record",
				"start",
				"--name",
				"Recorded CLI Package",
				"--domain",
				"example.com",
				"--json",
			]);
		});
		const started = JSON.parse(startedOutput) as { success: boolean; data: { id: string } };
		assert.equal(started.success, true);
		assert.match(started.data.id, /^rec-/);

		const actionOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"package",
				"record",
				"action",
				"terminal-exec",
				"--params",
				'{"command":"echo packaged"}',
				"--json",
			]);
		});
		const action = JSON.parse(actionOutput) as { success: boolean; data: { kind: string } };
		assert.equal(action.success, true);
		assert.equal(action.data.kind, "terminal-exec");

		const stoppedOutput = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "package", "record", "stop", "--json"]);
		});
		const stopped = JSON.parse(stoppedOutput) as { success: boolean; data: { id: string } };
		assert.equal(stopped.success, true);
		assert.equal(stopped.data.id, started.data.id);

		const draftOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"package",
				"draft",
				started.data.id,
				"--json",
			]);
		});
		const draft = JSON.parse(draftOutput) as {
			success: boolean;
			data: { package: { manifest: { name: string } } };
		};
		assert.equal(draft.success, true);
		assert.equal(draft.data.package.manifest.name, "recorded-cli-package");

		const materializedOutput = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"package",
				"materialize",
				started.data.id,
				"--overwrite",
				"--json",
			]);
		});
		const materialized = JSON.parse(materializedOutput) as {
			success: boolean;
			data: { packageDir: string; manifestPath: string };
		};
		assert.equal(materialized.success, true);
		assert.ok(materialized.data.packageDir.includes("recorded-cli-package"));
		assert.equal(fs.existsSync(materialized.data.manifestPath), true);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
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
		await sleep(500);
		assert.equal(child.killed, false, "serve process should still be alive");

		await killPid(child.pid);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
	}
});

test("bc web serve --open --json --port=0 exits cleanly", async () => {
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
				"serve",
				"--open",
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
		const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
		const firstLine = lines[0];
		const parsed = JSON.parse(firstLine);
		assert.strictEqual(parsed.success, true);
		assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		assert.equal(await requestStatus(parsed.url, parsed.token), 200);
		// Kill the background web server (PID included in JSON output).
		if (parsed.pid) {
			await killPid(parsed.pid);
		}
		await sleep(500);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
	}
});

test("bc web open remains a JSON-safe compatibility alias", async () => {
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
		const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/u).filter(Boolean)[0]);
		assert.strictEqual(parsed.success, true);
		assert.match(parsed.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		if (parsed.pid) {
			await killPid(parsed.pid);
		}
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
	}
});

test("bc web serve --open --json --port=N exits with a reachable URL", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	let parsed:
		| { success: boolean; pid?: number; url: string; token: string }
		| undefined;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const explicitPort = await getFreePort();
		const tokenPath = path.join(home, "secrets", "web-dashboard-token");
		const explicit = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"web",
				"serve",
				"--open",
				"--json",
				"--port",
				String(explicitPort),
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
				timeout: 10000,
			},
		);

		assert.equal(explicit.status, 0, explicit.stderr);
		parsed = JSON.parse(explicit.stdout.trim().split(/\r?\n/).filter(Boolean)[0]);
		assert.strictEqual(parsed?.success, true);
		assert.match(parsed.url, new RegExp(`^http://127\\.0\\.0\\.1:${explicitPort}$`, "u"));
		assert.equal(await requestStatus(parsed.url, parsed.token), 200);
		assert.equal(fs.readFileSync(tokenPath, "utf8").trim(), parsed.token);
	} finally {
		if (parsed?.pid) {
			await killPid(parsed.pid);
		}
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
	}
});

test("bc web serve persists reusable server info and bc web serve --open reuses it", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const recordPath = path.join(home, "runtime", "web-server.json");
	const port = await getFreePort();
	let childPid: number | undefined;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
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
				String(port),
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
			},
		);
		childPid = child.pid;

		let output = "";
		for await (const chunk of child.stdout) {
			output += chunk;
			if (output.includes("\n")) break;
		}

		const served = JSON.parse(output.trim().split(/\r?\n/u)[0]) as {
			success: boolean;
			url: string;
			token: string;
		};
		assert.equal(served.success, true);
		assert.equal(fs.existsSync(recordPath), true);
		const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as {
			url: string;
			token: string;
			port: number;
			pid: number;
			startedAt: string;
		};
		assert.equal(record.url, served.url);
		assert.equal(record.token, served.token);
		assert.equal(record.port, port);
		assert.equal(typeof record.pid, "number");
		assert.equal(typeof record.startedAt, "string");

		const reusedResult = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"web",
				"serve",
				"--open",
				"--json",
				"--port",
				String(port),
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
				timeout: 10000,
			},
		);

		assert.equal(reusedResult.status, 0, reusedResult.stderr);
		const reused = JSON.parse(
			reusedResult.stdout.trim().split(/\r?\n/u)[0],
		) as {
			success: boolean;
			url: string;
			token: string;
			openUrl: string;
		};
		assert.equal(reused.success, true);
		assert.equal(reused.url, served.url);
		assert.equal(reused.token, served.token);
		assert.equal(reused.openUrl, `${served.url}/#token=${served.token}`);

	} finally {
		await killPid(childPid);
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		await removeHome(home);
	}
});

test("bc web serve --open reports readable fallback when an unknown process owns the port", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const busyServer = http.createServer((_request, response) => {
		response.end("busy");
	});
	const port = await getFreePort();
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		await new Promise<void>((resolve) =>
			busyServer.listen(port, "127.0.0.1", resolve),
		);

		const result = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"web",
				"serve",
				"--open",
				"--json",
				"--port",
				String(port),
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
				timeout: 10000,
			},
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, new RegExp(`port ${port} is busy`, "i"));
		assert.match(result.stderr, /bc web serve --open --port=0/i);
		assert.match(result.stderr, /Source checkout: `npm run cli -- web serve --open --port=0`./i);
	} finally {
		await new Promise((resolve) => busyServer.close(() => resolve(undefined)));
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

test("CLI background spawns use sanitized child env", () => {
	const cliPath = path.join(process.cwd(), "src", "cli.ts");
	const content = fs.readFileSync(cliPath, "utf8");
	assert.match(content, /buildSafeChildEnv\(process\.env/u);
	assert.doesNotMatch(content, /env:\s*process\.env/u);
	assert.doesNotMatch(content, /\.\.\.process\.env/u);
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

test("bc --help is package-first", () => {
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
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.ok(
			result.stdout.indexOf("Automation Packages") < result.stdout.indexOf("Operator"),
			"Automation Packages should appear before Operator commands",
		);
		assert.ok(
			result.stdout.indexOf("package record start") < result.stdout.indexOf("browser open"),
			"package creation workflow should appear before raw browser commands",
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc package --help shows package-focused help", () => {
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
				"package",
				"--help",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Usage: bc package <command>/);
		assert.match(result.stdout, /package record start/);
		assert.match(result.stdout, /package run <name> \[workflow\]/);
		assert.doesNotMatch(result.stdout, /Browser Actions:/);
		assert.doesNotMatch(result.stdout, /Service Management:/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc help package shows package-focused help", () => {
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
				"help",
				"package",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Usage: bc package <command>/);
		assert.match(result.stdout, /package record start/);
		assert.match(result.stdout, /package run <name> \[workflow\]/);
		assert.doesNotMatch(result.stdout, /Service Management:/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc --help keeps promoted browser command guidance current", () => {
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
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /Browser Commands:/);
		assert.match(result.stdout, /Browser Namespace \(compatibility\):/);
		assert.doesNotMatch(result.stdout, /term view <sessionId>/);
		assert.doesNotMatch(result.stdout, /Shortcut for:/);
		assert.doesNotMatch(
			result.stdout,
			/^  capture \[--snapshot\]/m,
			"deprecated capture command must not appear in primary browser commands",
		);
		assert.match(
			result.stdout,
			/browser capture \[--snapshot\] \[--screenshot\] \[--json\]\s+Deprecated alias for browser state/,
		);
		for (const command of [
			"open [url]",
			"snapshot",
			"state",
			"act <action>",
			"task run",
			"tab close",
			"provider list",
			"downloads list",
			"click <ref-or-target>",
			"fill <ref-or-target> <text>",
		]) {
			assert.match(
				result.stdout,
				new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
				`help missing promoted browser command ${command}`,
			);
		}
		for (const browserCommand of [
			"browser list",
			"browser detach",
			"browser open [url]",
			"browser navigate <url>",
			"browser open-many",
			"browser capture ",
			"browser capture-many",
			"browser tab list",
			"browser tab switch <id>",
			"browser highlight [target]",
			"browser drop <target>",
			"browser downloads list",
		]) {
			assert.match(
				result.stdout,
				new RegExp(browserCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
				`help missing implemented browser command ${browserCommand}`,
			);
		}
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc --help clarifies daemon status scope", () => {
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
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /status \[--json\]\s+Show daemon, broker, sessions, tasks, and health/);
		assert.match(result.stdout, /daemon status\s+Show daemon-only status; use 'bc status' for full system status/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc --help omits internal memory store commands", () => {
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
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.doesNotMatch(result.stdout, /\bmemory stats\b/);
		assert.doesNotMatch(result.stdout, /\bmemory clear\b/);
		assert.doesNotMatch(result.stdout, /\bmemory get <key>\b/);
		assert.doesNotMatch(result.stdout, /\bmemory set <key> <value>\b/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc --help documents security-sensitive operator commands", () => {
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
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /vault list\|set\|delete\|grants/);
		assert.match(result.stdout, /Manage local credential vault secrets and grants/);
		assert.match(result.stdout, /captcha test \[--json\]/);
		assert.match(result.stdout, /network rules list\|add\|remove/);
		assert.match(result.stdout, /proxy list\|add\|remove\|test/);
		assert.doesNotMatch(result.stdout, /network proxy list\|add\|remove\|test/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("removed term view alias fails before daemon work starts", () => {
	const home = makeHome();
	try {
		const termViewResult = spawnSync(
			process.execPath,
			[
				"--require",
				"ts-node/register",
				"--require",
				"tsconfig-paths/register",
				"src/cli.ts",
				"term",
				"view",
				"term-test",
				"--json",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.notEqual(termViewResult.status, 0);
		assert.match(termViewResult.stderr, /Unknown term command: view/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("unknown browser command lists implemented recovery commands", () => {
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
				"browser",
				"unknown",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.notEqual(result.status, 0);
		for (const command of [
			"list",
			"detach",
			"open",
			"snapshot",
			"drop",
			"downloads",
			"open-many",
			"capture-many",
		]) {
			assert.match(result.stderr, new RegExp(`\\b${command}\\b`));
		}
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("unknown schedule command is not treated as a schedule id", () => {
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
				"schedule",
				"lst",
				"--json",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unknown schedule command: lst/);
		assert.match(result.stdout, /schedule list/);
		assert.doesNotMatch(result.stderr, /--cron is required/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("empty schedule command prints schedule usage", () => {
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
				"schedule",
				"--json",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /schedule command or task ID is required/);
		assert.match(result.stdout, /Usage: bc schedule/);
		assert.match(result.stdout, /schedule list/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("skill CLI surface is removed in favor of package commands", () => {
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
				"skill",
				"list",
				"--json",
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, BROWSER_CONTROL_HOME: home },
				encoding: "utf8",
			},
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unknown command: skill/);
		assert.match(result.stdout, /package list \[--json\]/);
		assert.doesNotMatch(result.stdout, /\nskill\s/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("top-level browser shortcuts keep the first user argument", () => {
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

test("top-level browser shortcuts use the unified BrowserControl path", () => {
	const source = fs.readFileSync(path.join(process.cwd(), "src", "cli.ts"), "utf8");
	assert.doesNotMatch(source, /new BrowserActions/);
	assert.doesNotMatch(source, /import\(["']\.\/browser\/actions["']\)/);
	assert.match(source, /async function handleBrowserAction/);
	assert.match(source, /await handleBrowser\(/);
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
				dialogHandling: "must_respond",
				dialogTimeoutMs: 10000,
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

test("bc browser provider add verifies reachable endpoint before saving", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("ok");
	});
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address() as AddressInfo;
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"browser",
				"provider",
				"add",
				"reachable-custom",
				"--type=custom",
				`--endpoint=http://127.0.0.1:${address.port}`,
				"--yes",
				"--json",
			]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.success, true);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc browser provider add rejects unreachable endpoint before saving", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const deadPort = await getFreePort();
		const output = await captureStdout(async () => {
			await runCli([
				"node",
				"cli.ts",
				"browser",
				"provider",
				"add",
				"dead-custom",
				"--type=custom",
				`--endpoint=http://127.0.0.1:${deadPort}`,
				"--yes",
				"--json",
			]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.success, false);
		assert.equal(parsed.persisted, false);
		assert.match(parsed.error, /not reachable/i);
		const registryPath = path.join(home, "providers", "registry.json");
		if (fs.existsSync(registryPath)) {
			assert.doesNotMatch(fs.readFileSync(registryPath, "utf8"), /dead-custom/u);
		}
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

test("bc proxy list delegates to proxy inventory", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "proxy", "list", "--json"]);
		});
		const parsed = JSON.parse(output);
		assert.deepEqual(parsed, []);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc network proxy list remains a JSON-safe compatibility alias", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "network", "proxy", "list", "--json"]);
		});
		const parsed = JSON.parse(output);
		assert.deepEqual(parsed, []);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc daemon status --json uses status daemon data shape", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "daemon", "status", "--json"]);
		});
		const parsed = JSON.parse(output);
		assert.equal(parsed.running, false);
		assert.equal(parsed.state, "stopped");
		assert.ok(parsed.broker);
		assert.equal(parsed.broker.reachable, false);
		assert.ok(parsed.health);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("bc daemon status human output points to full status", async () => {
	const home = makeHome();
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	try {
		process.env.BROWSER_CONTROL_HOME = home;
		const output = await captureStdout(async () => {
			await runCli(["node", "cli.ts", "daemon", "status"]);
		});
		assert.match(output, /Daemon is not running/);
		assert.match(output, /Scope: daemon only\. Use 'bc status' for full system status\./);
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
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
