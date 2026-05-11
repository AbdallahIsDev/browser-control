import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
