#!/usr/bin/env ts-node

import fs from "node:fs";
import path from "node:path";
import type { LocatorCandidate, OpenOptions } from "./browser/actions";
import type { BrowserTargetType } from "./browser/connection";
import type { KnowledgeKind, ValidationResult } from "./knowledge/types";
import type { ScreencastOptions } from "./observability/types";
import type { ProviderConfig } from "./providers/types";

// DEFAULT_PORT kept for help text; actual port comes from loadConfig()

interface ParsedArgs {
	command: string;
	subcommand?: string;
	flags: Record<string, string>;
	positional: string[];
}

interface StoredBrowserConnectionState {
	status?: string;
	profileId?: string;
	cdpEndpoint?: string;
	targetType?: BrowserTargetType;
}

const VALUE_FLAGS = new Set([
	"action",
	"amount",
	"api-key",
	"browser-mode",
	"browserless-api-key",
	"browserless-endpoint",
	"cdp-url",
	"chrome-bind-address",
	"chrome-debug-port",
	"chrome-path",
	"command",
	"confirm",
	"content",
	"cron",
	"cwd",
	"data",
	"daemon-socket",
	"debug-endpoint",
	"delay",
	"endpoint",
	"ext",
	"file",
	"files",
	"format",
	"health-check-interval",
	"help",
	"host",
	"iterations",
	"key",
	"kind",
	"label",
	"last",
	"list",
	"max-bytes",
	"message",
	"mime-type",
	"name",
	"output",
	"params",
	"path",
	"pattern",
	"policy",
	"port",
	"priority",
	"profile",
	"protocol",
	"provider",
	"query",
	"region",
	"retention",
	"root-selector",
	"screenshot-path",
	"session",
	"shell",
	"show-actions",
	"skill",
	"style",
	"suite",
	"target",
	"target-type",
	"terminal-shell",
	"token",
	"timeout",
	"timeoutMs",
	"type",
	"url",
	"value",
	"wait-until",
	"annotation-position",
]);

// Flags that can be repeated and should be collected as arrays
const REPEATED_FLAGS = new Set(["file", "files", "data"]);

export function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const result: ParsedArgs = {
		command: "",
		subcommand: undefined,
		flags: {},
		positional: [],
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg.startsWith("--")) {
			const flagPart = arg.slice(2);
			const eqIndex = flagPart.indexOf("=");
			if (eqIndex !== -1) {
				const key = flagPart.slice(0, eqIndex);
				const value = flagPart.slice(eqIndex + 1);
				// Handle repeated flags by appending with null character delimiter
				if (REPEATED_FLAGS.has(key)) {
					if (result.flags[key]) {
						result.flags[key] = `${result.flags[key]}\0${value}`;
					} else {
						result.flags[key] = value;
					}
				} else {
					result.flags[key] = value;
				}
			} else if (
				VALUE_FLAGS.has(flagPart) &&
				args[i + 1] &&
				!args[i + 1].startsWith("-")
			) {
				// Handle repeated flags with space-separated values
				if (REPEATED_FLAGS.has(flagPart)) {
					if (result.flags[flagPart]) {
						result.flags[flagPart] =
							`${result.flags[flagPart]}\0${args[i + 1]}`;
					} else {
						result.flags[flagPart] = args[i + 1];
					}
				} else {
					result.flags[flagPart] = args[i + 1];
				}
				i++;
			} else {
				result.flags[flagPart] = "true";
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			// Handle short flags like -h
			const key = arg.slice(1);
			result.flags[key] = "true";
		} else if (!result.command) {
			result.command = arg;
		} else if (!result.subcommand) {
			result.subcommand = arg;
		} else {
			result.positional.push(arg);
		}

		i++;
	}

	return result;
}

function isKnowledgeKind(value: string): value is KnowledgeKind {
	return value === "interaction-skill" || value === "domain-skill";
}

function parseWaitUntil(value: string | undefined): OpenOptions["waitUntil"] {
	if (value === undefined) return "domcontentloaded";
	if (
		value === "load" ||
		value === "domcontentloaded" ||
		value === "networkidle" ||
		value === "commit"
	) {
		return value;
	}
	throw new Error(
		`Invalid --wait-until "${value}". Expected load, domcontentloaded, networkidle, or commit.`,
	);
}

function parseAnnotationPosition(
	value: string | undefined,
): ScreencastOptions["annotationPosition"] {
	if (value === undefined) return undefined;
	if (
		value === "top-left" ||
		value === "top" ||
		value === "top-right" ||
		value === "bottom-left" ||
		value === "bottom" ||
		value === "bottom-right"
	) {
		return value;
	}
	throw new Error(
		`Invalid --annotation-position "${value}". Expected top-left, top, top-right, bottom-left, bottom, or bottom-right.`,
	);
}

function parseScreencastRetention(
	value: string | undefined,
): ScreencastOptions["retention"] {
	if (value === undefined) return undefined;
	if (
		value === "keep" ||
		value === "delete-on-success" ||
		value === "debug-only"
	) {
		return value;
	}
	throw new Error(
		`Invalid --retention "${value}". Expected keep, delete-on-success, or debug-only.`,
	);
}

let jsonOutputWarningGuardInstalled = false;

function installJsonOutputGuards(): void {
	if (jsonOutputWarningGuardInstalled) return;
	jsonOutputWarningGuardInstalled = true;

	const emitWarning = process.emitWarning;
	process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
		const warningType =
			typeof args[0] === "string"
				? args[0]
				: typeof args[0] === "object" && args[0] !== null && "type" in args[0]
					? String((args[0] as { type?: unknown }).type)
					: undefined;
		const message = typeof warning === "string" ? warning : warning.message;

		if (warningType === "ExperimentalWarning" && message.includes("SQLite")) {
			return;
		}

		return (emitWarning as (...innerArgs: unknown[]) => void).call(
			process,
			warning,
			...args,
		);
	}) as typeof process.emitWarning;
}

async function isCdpEndpointReachable(endpoint: unknown): Promise<boolean> {
	if (typeof endpoint !== "string" || endpoint.length === 0) return false;
	try {
		const url = new URL(endpoint);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 1000);
		try {
			const response = await fetch(new URL("/json/version", url), {
				signal: controller.signal,
			});
			return response.ok;
		} finally {
			clearTimeout(timeout);
		}
	} catch {
		return false;
	}
}

async function normalizePersistedBrowserStatus(
	connectionState: Record<string, unknown>,
	store: { set: (key: string, value: unknown) => void },
): Promise<Record<string, unknown>> {
	if (connectionState.status !== "connected") return connectionState;
	const reachable = await isCdpEndpointReachable(connectionState.cdpEndpoint);
	if (reachable) return { ...connectionState, reachable: true };

	const staleState = {
		...connectionState,
		status: "disconnected",
		reachable: false,
		disconnectedAt: new Date().toISOString(),
	};
	store.set("browser_connection:active", staleState);
	return staleState;
}

export function getBrowserActionPositionals(
	action: string,
	args: ParsedArgs,
): string[] {
	return action === "tab"
		? args.positional
		: [args.subcommand, ...args.positional].filter((value): value is string =>
				Boolean(value),
			);
}

async function getApiUrl(): Promise<string> {
	const { loadConfig } = await import("./shared/config");
	const config = loadConfig({ validate: false });
	return `http://127.0.0.1:${config.brokerPort}/api/v1`;
}

async function apiRequest(
	endpoint: string,
	method = "GET",
	body?: unknown,
): Promise<unknown> {
	const apiUrl = await getApiUrl();
	const url = `${apiUrl}${endpoint}`;
	const options: RequestInit = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body) {
		options.body = JSON.stringify(body);
	}

	let response: Response;
	try {
		response = await fetch(url, options);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
			throw new Error(
				`Broker is not reachable at ${apiUrl}. Run "bc daemon start" for daemon-backed commands.`,
			);
		}
		throw error;
	}
	if (!response.ok) {
		const errorBody = await response.text().catch(() => "Unknown error");
		throw new Error(
			`API ${method} ${endpoint} failed with HTTP ${response.status}: ${errorBody}`,
		);
	}
	return response.json();
}

async function loadCliSkillRegistry(
	skillsDataDir?: string,
): Promise<import("./skill_registry").SkillRegistry> {
	const { SkillRegistry } = await import("./skill_registry");
	const registry = new SkillRegistry();
	const dataDir =
		skillsDataDir ?? (await import("./shared/paths")).getSkillsDataDir();
	const candidateDirs = [
		path.join(__dirname, "skills"),
		path.join(__dirname, "..", "skills"),
		dataDir,
	];

	for (const dir of Array.from(new Set(candidateDirs))) {
		await registry.loadFromDirectory(dir);
	}

	return registry;
}

function outputJson(data: unknown, pretty = true): void {
	console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

async function requireCliPolicy(
	action: string,
	params: Record<string, unknown>,
	jsonOutput: boolean,
	confirmed = false,
): Promise<void> {
	const [{ MemoryStore }, { SessionManager, isPolicyAllowed }] =
		await Promise.all([
			import("./runtime/memory_store"),
			import("./session_manager"),
		]);
	const store = new MemoryStore({ filename: ":memory:" });
	try {
		const manager = new SessionManager({ memoryStore: store });
		const policyEval = manager.evaluateAction(action, params);
		if (!isPolicyAllowed(policyEval)) {
			if (confirmed && policyEval.policyDecision === "require_confirmation") {
				return;
			}
			if (jsonOutput) outputJson(policyEval, false);
			else {
				console.error(policyEval.error ?? "Policy denied.");
				if (policyEval.policyDecision === "require_confirmation") {
					console.error("Rerun with --yes to confirm this high-risk action.");
				}
			}
			process.exit(1);
		}
	} finally {
		store.close();
	}
}

function printHelp(): void {
	console.log(`
Browser Control CLI

Usage: bc <command> [subcommand] [options]

Operator:
  doctor [--json]                                                    Run operator diagnostics
  setup [--json] [--non-interactive] [--profile=balanced] [--browser-mode=managed|attach]
        [--chrome-debug-port=9222] [--chrome-bind-address=127.0.0.1]
        [--terminal-shell=pwsh] [--browserless-endpoint=<url>]
        [--browserless-api-key=<key>] [--skip-browser-test] [--skip-terminal-test]
                                                                      Create/update user config
  config list|get|set                                                Inspect or update effective config
  status [--json]                                                    Show daemon, broker, sessions, tasks, and health
  data doctor|cleanup|export [--json]                                Inspect, clean, or export local data home
  benchmark run|results|compare [--suite=<name>] [--json]            Run and inspect product benchmarks
  dashboard status [--json]                                          Show dashboard state
  dashboard open [--json] [--port=7790]                              Start/open local dashboard
  web serve [--json] [--host=127.0.0.1] [--port=7790] [--token=<token>]
                                                                      Start local web app server
  web open [--json] [--port=7790]                                    Start and open local web app server
  desktop start [--json]                                             Start the Electron desktop wrapper

Workflow Graph (Section 29):
  workflow run <graphPathOrName> [--json]                            Run a workflow graph
  workflow status <runId> [--json]                                   Show workflow run status
  workflow resume <runId> [--json]                                   Resume a workflow run
  workflow approve <runId> <nodeId> [--json]                         Approve a workflow node
  workflow cancel <runId> [--json]                                   Cancel a workflow run

Self-Healing Harness (Section 29):
  harness list [--json]                                              List registered helpers
  harness validate <helperId> [--json]                               Validate a helper
  harness rollback <helperId> <version> [--json]                     Rollback a helper

Automation Packages (Section 30):
  package install <source> [--json]                                  Install a package from local directory
  package list [--json]                                              List installed packages
  package info <name> [--json]                                       Show package info
  package remove <name> [--json]                                     Remove an installed package
  package update <name> [source] [--json]                            Update an installed package
  package grant <name> <permission-kind-or-index> [--json]            Grant a declared package permission
  package run <name> <workflow> [--json]                             Run a package workflow
  package eval <name> [--json]                                       Evaluate a package

Browser Actions:
  open <url>                                                         Open a URL in the browser
  snapshot                                                           Take an accessibility snapshot
  click <ref-or-target>                                              Click an element (ref, selector, or text)
  fill <ref-or-target> <text>                                        Fill an element with text
  hover <ref-or-target>                                             Hover over an element
  type <text>                                                        Type text into focused element
  press <key>                                                        Press a keyboard key
  scroll <direction>                                                 Scroll (up/down/left/right)
  screenshot [--output=<path>] [--full-page] [--target=<ref>]         Take a screenshot
  tab list                                                           List browser tabs
  tab switch <id>                                                    Switch to a browser tab
  close                                                              Close the current browser tab

Session:
  session list                                                       List sessions
  session create <name> [--policy=balanced]                         Create a new session
  session use <name-or-id>                                          Set the active session
  session status                                                     Show active session status

Browser Lifecycle:
  browser attach [--port=9222] [--cdp-url=...] [--target-type=chrome|chromium|electron] [--provider=<name>] [--yes]
                                                                      Attach to running Chrome/Electron
  browser launch [--port=9222] [--profile=default] [--provider=<name>]  Launch managed automation browser
  browser status                                                     Show browser connection status
  browser provider list                                              List browser providers
  browser provider use <name>                                        Set active browser provider
  browser provider add <name> --type=<type> --endpoint=<url>         Add or configure a browser provider
  browser provider remove <name>                                     Remove a configured browser provider
  browser profile list                                                List browser profiles
  browser profile create <name> [--type=named]                       Create a browser profile
  browser profile use <name>                                          Activate a browser profile
  browser profile delete <name>                                       Delete a browser profile
  browser auth export [--live | --stored] [--profile=default] [--output=<file>] [--yes]
                                                                      Export auth state (cookies/storage)
  browser auth import <file> [--live | --stored] [--profile=default] [--yes]
                                                                      Import auth state from file
  run --skill=<name> --action=<action> [--params='{"key":"value"}']  Run a task
  schedule <id> --cron="*/5 * * * *" --skill=<name> --action=<action> Schedule a task
  schedule list                                                      List scheduled tasks
  schedule pause <id>                                                Pause a scheduled task
  schedule resume <id>                                               Resume a scheduled task
  schedule remove <id>                                               Remove a scheduled task
  daemon start [--visible]                                           Start the daemon
  daemon stop                                                        Stop the daemon
  daemon status                                                      Check daemon status
  daemon health                                                      Run health checks
  daemon logs                                                        View daemon logs
  proxy test                                                         Test proxies
  proxy add <url>                                                    Add a proxy
  proxy remove <url>                                                 Remove a proxy
  proxy list                                                         List proxies
  memory stats                                                       Show memory stats
  memory clear                                                       Clear memory
  memory get <key>                                                   Get a memory key
  memory set <key> <value>                                           Set a memory key
  skill list                                                         List skills (name, version, actions)
  skill health <name>                                                Check skill health
  skill actions <name>                                               Show skill action metadata
  skill install <path>                                               Install a packaged skill from a directory
  skill validate <name-or-path>                                      Validate a skill manifest
  skill remove <name>                                                Remove an installed skill
  report generate                                                    Generate report
  report view                                                        View report
  captcha test                                                       Validate captcha solver configuration
  policy list                                                        List built-in policy profiles
  policy inspect <name>                                              Inspect a policy profile
  policy export <name> [file]                                         Export a policy profile to JSON
  policy import <file>                                               Import a custom policy profile
  knowledge list [--kind=interaction-skill|domain-skill]             List knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or skill
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact
  term open [--shell=<name>] [--cwd=<path>] [--name=<name>]           Open a terminal session
  term exec "<command>" [--session=<id>] [--timeout=<ms>]             Execute a command
  term type "<text>" --session=<id>                                   Type into a session
  term read [--session=<id>] [--max-bytes=<n>]                        Read recent output
  term snapshot [--session=<id>]                                      Capture terminal state
  term interrupt --session=<id>                                       Send Ctrl+C
  term close --session=<id>                                           Close a session
  term list                                                           List active sessions
  term resume <sessionId>                                             Resume a session from persisted state
  term status <sessionId>                                             Show resume status for a session
  term view <sessionId> [--dashboard]                                 View terminal render state for dashboard
  fs read <path> [--max-bytes=<n>]                                    Read a file
  fs write <path> [--content=<text>] [--yes]                           Write to a file
  fs ls <path> [--recursive] [--ext=<.ext>]                           List directory
  fs move <src> <dst> [--yes]                                          Move/rename
  fs rm <path> [--recursive] [--force] [--yes]                         Delete file/dir
  fs stat <path>                                                      File metadata

Service Management:
  service register <name> --port <port> [--protocol=http|https] [--path=/...] [--detect] [--cwd=<path>]
  service list                                                        List registered services
  service resolve <name>                                              Resolve service to URL
  service remove <name>                                               Remove a service

Debug:
  debug bundle <id> [--output=<path>] [--yes]                          Retrieve a debug bundle
  debug console [--session=<id>]                                      Show captured console entries
  debug network [--session=<id>]                                      Show captured network entries
  debug receipt <id>                                                  Get a debug receipt by ID (Section 26)

MCP:
  mcp serve                                                           Start MCP stdio server

Knowledge:
  knowledge list [--kind=interaction-skill|domain-skill]             List knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or skill
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact

Flags:
  --json                                                             Raw JSON output
  --help, -h                                                         Show help

Environment:
  BROKER_PORT                                                        Broker API port (default: 7788)
`);
}

async function handleDoctor(args: ParsedArgs): Promise<void> {
	const jsonOutput = args.flags.json === "true";
	const [{ runDoctor }, { formatDoctor }] = await Promise.all([
		import("./operator/doctor"),
		import("./operator/format"),
	]);
	const result = await runDoctor();
	if (jsonOutput) {
		outputJson(result.report, false);
	} else {
		console.log(formatDoctor(result.report));
	}
	process.exitCode = result.exitCode;
}

async function handleSetup(args: ParsedArgs): Promise<void> {
	const jsonOutput = args.flags.json === "true";
	const [{ runSetup }, { formatSetup }] = await Promise.all([
		import("./operator/setup"),
		import("./operator/format"),
	]);
	const result = await runSetup({
		nonInteractive: args.flags["non-interactive"] === "true",
		json: jsonOutput,
		profile: args.flags.profile,
		browserMode: args.flags["browser-mode"] as "managed" | "attach" | undefined,
		chromeDebugPort: args.flags["chrome-debug-port"]
			? Number(args.flags["chrome-debug-port"])
			: undefined,
		chromeBindAddress: args.flags["chrome-bind-address"],
		terminalShell: args.flags["terminal-shell"] ?? args.flags.shell,
		browserlessEndpoint: args.flags["browserless-endpoint"],
		browserlessApiKey: args.flags["browserless-api-key"],
		skipBrowserTest: args.flags["skip-browser-test"] === "true",
		skipTerminalTest: args.flags["skip-terminal-test"] === "true",
	});
	if (jsonOutput) outputJson(result, false);
	else console.log(formatSetup(result));
	process.exitCode = result.success ? 0 : 1;
}

async function handleConfig(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const [
		{ getConfigEntries, getConfigValue, setUserConfigValue },
		{ formatConfigGet, formatConfigList, formatConfigSet },
	] = await Promise.all([
		import("./shared/config"),
		import("./operator/format"),
	]);

	switch (subcommand) {
		case "list": {
			const entries = getConfigEntries({ validate: false });
			if (jsonOutput) outputJson(entries, false);
			else console.log(formatConfigList(entries));
			break;
		}
		case "get": {
			const key = positional[0];
			if (!key) {
				console.error("Error: config get requires a key");
				process.exit(1);
			}
			const entry = getConfigValue(key, { validate: false });
			if (jsonOutput) outputJson(entry, false);
			else console.log(formatConfigGet(entry));
			break;
		}
		case "set": {
			const key = positional[0];
			const value = positional[1];
			if (!key || value === undefined) {
				console.error("Error: config set requires <key> <value>");
				process.exit(1);
			}
			await requireCliPolicy("config_set", { key, value }, jsonOutput);
			const result = setUserConfigValue(key, value);
			if (jsonOutput) outputJson(result, false);
			else console.log(formatConfigSet(result));
			break;
		}
		default:
			console.error(`Unknown config command: ${subcommand}`);
			console.error("Available: list, get, set");
			process.exit(1);
	}
}

async function handleStatus(args: ParsedArgs): Promise<void> {
	const jsonOutput = args.flags.json === "true";
	const [{ collectStatus }, { formatStatus }] = await Promise.all([
		import("./operator/status"),
		import("./operator/format"),
	]);
	const status = await collectStatus();
	if (jsonOutput) outputJson(status, false);
	else console.log(formatStatus(status));
}

async function handleRun(args: ParsedArgs): Promise<void> {
	const { flags } = args;
	const jsonOutput = flags.json === "true";

	if (!flags.skill || !flags.action) {
		console.error("Error: --skill and --action are required");
		process.exit(1);
	}

	const body: Record<string, unknown> = {};
	if (flags.skill) body.skill = flags.skill;
	if (flags.action) body.action = flags.action;
	if (flags.params) {
		try {
			body.params = JSON.parse(flags.params);
		} catch {
			console.error("Error: Invalid JSON in --params");
			process.exit(1);
		}
	}
	if (flags.priority) body.priority = flags.priority;
	if (flags.timeoutMs) body.timeoutMs = Number(flags.timeoutMs);

	try {
		const result = await apiRequest("/tasks/run", "POST", body);
		outputJson(result, !jsonOutput);
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

async function handleSchedule(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	switch (subcommand) {
		case "list": {
			try {
				const result = await apiRequest("/scheduler");
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "pause":
		case "resume": {
			const id = positional[0];
			if (!id) {
				console.error("Error: Task ID is required");
				process.exit(1);
			}
			try {
				const result = await apiRequest(
					`/scheduler/${id}/${subcommand}`,
					"POST",
				);
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "remove": {
			const id = positional[0];
			if (!id) {
				console.error("Error: Task ID is required");
				process.exit(1);
			}
			try {
				const result = await apiRequest(`/scheduler/${id}`, "DELETE");
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		default: {
			// Schedule a new task: schedule <id> --cron=... --skill=... --action=...
			const id = subcommand;
			if (!id) {
				console.error("Error: Task ID is required");
				process.exit(1);
			}
			if (!flags.cron) {
				console.error("Error: --cron is required");
				process.exit(1);
			}

			const body: Record<string, unknown> = {
				id,
				name: flags.name || id,
				cronExpression: flags.cron,
			};

			if (flags.skill) body.skill = flags.skill;
			if (flags.action) body.action = flags.action;
			if (flags.params) {
				try {
					body.params = JSON.parse(flags.params);
				} catch {
					console.error("Error: Invalid JSON in --params");
					process.exit(1);
				}
			}

			try {
				const result = await apiRequest("/tasks/schedule", "POST", body);
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}
	}
}

// ── Daemon Cleanup Helpers ──────────────────────────────────────────

async function cleanupStaleDaemonStatus(): Promise<void> {
	const { cleanupStaleDaemonFiles } = await import("./runtime/daemon_cleanup");
	cleanupStaleDaemonFiles();
}

function readRecentFile(pathname: string, maxBytes = 4000): string {
	try {
		if (!fs.existsSync(pathname)) return "";
		const stat = fs.statSync(pathname);
		const start = Math.max(0, stat.size - maxBytes);
		const fd = fs.openSync(pathname, "r");
		try {
			const buffer = Buffer.alloc(stat.size - start);
			fs.readSync(fd, buffer, 0, buffer.length, start);
			return buffer.toString("utf8");
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return "";
	}
}

async function handleDaemon(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const { getPidFilePath, getReportsDir } = await import("./shared/paths");

	switch (subcommand) {
		case "start": {
			const { spawnDaemonProcess } = await import("./runtime/daemon_launch");
			const { getLogsDir } = await import("./shared/paths");
			const logsDir = getLogsDir();
			fs.mkdirSync(logsDir, { recursive: true });
			const daemonLogPath = path.join(logsDir, "daemon-start.log");
			const daemonLogFd = fs.openSync(daemonLogPath, "a");
			const daemonProcess = spawnDaemonProcess({
				visible: flags.visible === "true",
				detached: true,
				stdio: ["ignore", "ignore", daemonLogFd],
			});

			const errorChunks: Buffer[] = [];
			daemonProcess.stderr?.on("data", (chunk: Buffer) => {
				errorChunks.push(chunk);
			});

			// Wait only long enough to catch immediate spawn failures. Readiness is
			// probed separately below so this command does not feel stuck.
			const startupTimeout = 1500;
			const exited = await new Promise<boolean>((resolve) => {
				daemonProcess.on("exit", () => resolve(true));
				setTimeout(() => resolve(false), startupTimeout);
			});

			if (exited) {
				const errorOutput =
					Buffer.concat(errorChunks).toString("utf8") ||
					readRecentFile(daemonLogPath);
				console.error(
					"Daemon failed to start:",
					errorOutput || `Process exited immediately. Log: ${daemonLogPath}`,
				);
				// Clean up the child process handle — daemon is already dead,
				// but the stderr pipe and listeners still hold references.
				daemonProcess.stderr?.destroy();
				daemonProcess.removeAllListeners();
				fs.closeSync(daemonLogFd);
				process.exit(1);
			}

			// Process is still running after timeout — ensure data dir and persist PID.
			// CRITICAL: destroy() the stderr stream to close the underlying pipe FD.
			// Without this, the open pipe handle keeps the Node.js event loop alive,
			// preventing the CLI process from exiting (the cold-start hang bug).
			daemonProcess.stderr?.destroy();
			daemonProcess.removeAllListeners();
			fs.closeSync(daemonLogFd);
			const interopDir = path.dirname(getPidFilePath());
			if (!fs.existsSync(interopDir)) {
				fs.mkdirSync(interopDir, { recursive: true });
			}
			fs.writeFileSync(getPidFilePath(), String(daemonProcess.pid));
			daemonProcess.unref();

			// Probe briefly so pasted command batches are not blocked for a long,
			// silent startup. Follow-up commands can still poll daemon status.
			const { probeDaemonHealth, probeTerminalReadiness } = await import(
				"./session_manager"
			);
			const { loadConfig } = await import("./shared/config");
			let daemonReady = false;
			let daemonBrokerUrl = "";
			const maxRetries = 12;
			const retryDelayMs = 500;
			const startupConfig = loadConfig({ validate: false });
			const startupBrokerUrl = `http://127.0.0.1:${startupConfig.brokerPort}`;
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				const directTermReady = await probeTerminalReadiness(startupBrokerUrl);
				if (directTermReady) {
					daemonReady = true;
					daemonBrokerUrl = startupBrokerUrl;
					break;
				}

				const healthResult = await probeDaemonHealth();
				if (healthResult.running) {
					// Health OK — verify terminal readiness too
					const termReady = await probeTerminalReadiness(
						healthResult.brokerUrl,
					);
					if (termReady) {
						daemonReady = true;
						daemonBrokerUrl = healthResult.brokerUrl;
						break;
					}
					// Health OK but terminal not ready — keep retrying
				}
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				if (daemonProcess.exitCode !== null || daemonProcess.killed) {
					const errorOutput = readRecentFile(daemonLogPath);
					console.error("Daemon exited before becoming ready.");
					if (errorOutput) console.error(errorOutput);
					console.error(`Log: ${daemonLogPath}`);
					process.exit(1);
				}
			}

			if (daemonReady) {
				console.log(
					`Daemon started with PID: ${daemonProcess.pid} (ready at ${daemonBrokerUrl})`,
				);
			} else {
				console.log(
					`Daemon started with PID: ${daemonProcess.pid} (not ready yet at ${startupBrokerUrl}; log: ${daemonLogPath})`,
				);
			}
			break;
		}

		case "stop": {
			if (!fs.existsSync(getPidFilePath())) {
				console.log("Daemon is not running (no PID file)");
				// Still clean up stale status file if daemon is gone
				await cleanupStaleDaemonStatus();
				process.exit(1);
			}

			const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
			try {
				const { stopDaemon } = await import("./runtime/daemon_cleanup");
				await stopDaemon();
				console.log(`Daemon stopped (PID: ${pid})`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") {
					fs.unlinkSync(getPidFilePath());
					await cleanupStaleDaemonStatus();
					console.log("Daemon was not running (stale PID file removed)");
				} else {
					// Do NOT delete the PID file on real errors (e.g., access denied).
					// The user may need to retry `bc daemon stop` after fixing
					// permissions, and the PID file is essential for that.
					console.error("Error:", (error as Error).message);
					process.exit(1);
				}
			}
			break;
		}

		case "status": {
			if (!fs.existsSync(getPidFilePath())) {
				// No PID file — daemon is not running. Also clean up stale
				// daemon-status.json that may claim "running" from a previous
				// crash/force-kill.
				await cleanupStaleDaemonStatus();
				console.log(jsonOutput ? '{"running":false}' : "Daemon is not running");
				break;
			}

			const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
			try {
				process.kill(pid, 0); // Check if process exists
				const status = { running: true, pid };
				outputJson(status, !jsonOutput);
			} catch {
				// PID file exists but process is dead — stale state.
				// Remove both the PID file and the stale daemon-status.json.
				fs.unlinkSync(getPidFilePath());
				await cleanupStaleDaemonStatus();
				console.log(jsonOutput ? '{"running":false}' : "Daemon is not running");
			}
			break;
		}

		case "health": {
			try {
				const result = await apiRequest("/health");
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "logs": {
			const reportsDir = getReportsDir();
			if (!fs.existsSync(reportsDir)) {
				console.log("No reports directory found");
				break;
			}

			const files = fs
				.readdirSync(reportsDir)
				.filter((f) => f.endsWith(".json"))
				.sort()
				.reverse();

			if (files.length === 0) {
				console.log("No log files found");
				break;
			}

			// Show most recent log
			const latestFile = files[0];
			const content = fs.readFileSync(
				path.join(reportsDir, latestFile),
				"utf8",
			);
			const parsed = JSON.parse(content);
			outputJson(parsed, !jsonOutput);
			break;
		}

		default:
			console.error(`Unknown daemon command: ${subcommand}`);
			process.exit(1);
	}
}

async function handleProxy(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { loadProxyConfigs } = await import("./proxy_manager");

	switch (subcommand) {
		case "test": {
			try {
				const configs = loadProxyConfigs();
				const results = [];
				for (const config of configs) {
					results.push({ url: config.url, status: config.status });
				}
				outputJson(results, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "add": {
			const url = positional[0];
			if (!url) {
				console.error("Error: Proxy URL is required");
				process.exit(1);
			}

			try {
				const proxyPath = path.join(process.cwd(), "proxies.json");
				let configs = [];
				if (fs.existsSync(proxyPath)) {
					configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
				}

				if (configs.some((c: { url: string }) => c.url === url)) {
					console.log("Proxy already exists");
					break;
				}

				configs.push({ url, status: "active" });
				fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
				console.log(`Proxy added: ${url}`);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "remove": {
			const url = positional[0];
			if (!url) {
				console.error("Error: Proxy URL is required");
				process.exit(1);
			}

			try {
				const proxyPath = path.join(process.cwd(), "proxies.json");
				if (!fs.existsSync(proxyPath)) {
					console.log("No proxies configured");
					break;
				}

				let configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
				const initialLength = configs.length;
				configs = configs.filter((c: { url: string }) => c.url !== url);

				if (configs.length === initialLength) {
					console.log("Proxy not found");
					break;
				}

				fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
				console.log(`Proxy removed: ${url}`);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "list": {
			try {
				const configs = loadProxyConfigs();
				outputJson(configs, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown proxy command: ${subcommand}`);
			process.exit(1);
	}
}

async function handleMemory(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { MemoryStore } = await import("./runtime/memory_store");

	const store = new MemoryStore();

	try {
		switch (subcommand) {
			case "stats": {
				const stats = store.getStats();
				outputJson(stats, !jsonOutput);
				break;
			}

			case "clear": {
				store.clear();
				console.log("Memory cleared");
				break;
			}

			case "get": {
				const key = positional[0];
				if (!key) {
					console.error("Error: Key is required");
					process.exit(1);
				}
				const value = store.get(key);
				if (value === null) {
					console.log("Key not found");
				} else {
					outputJson({ key, value }, !jsonOutput);
				}
				break;
			}

			case "set": {
				const key = positional[0];
				const value = positional[1];
				if (!key || value === undefined) {
					console.error("Error: Key and value are required");
					process.exit(1);
				}
				store.set(key, value);
				console.log(`Key set: ${key}`);
				break;
			}

			default:
				console.error(`Unknown memory command: ${subcommand}`);
				process.exit(1);
		}
	} finally {
		store.close();
	}
}

async function handleSkill(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { getSkillsDataDir } = await import("./shared/paths");

	switch (subcommand) {
		case "list": {
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const result = registry.list() as unknown as Array<
					Record<string, unknown>
				>;
				if (jsonOutput) {
					outputJson(result, false);
				} else {
					// Enhanced list: show name, version, health, last run time
					if (!Array.isArray(result) || result.length === 0) {
						console.log("No skills registered.");
						break;
					}
					for (const skill of result) {
						const name = skill.name ?? "?";
						const version = skill.version ?? "?";
						const actions = Array.isArray(skill.actions)
							? ` (${skill.actions.length} action(s))`
							: "";
						console.log(`  ${name}@${version}${actions}`);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "health": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				process.exit(1);
			}
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const skill = registry.get(name);
				if (!skill) {
					console.error(`Error: Skill "${name}" not found`);
					process.exit(1);
				}
				const env = registry.validateEnv(name);
				const result = env.valid
					? { healthy: true, details: "Required environment is configured." }
					: {
							healthy: false,
							details: `Missing required env: ${env.missing.join(", ")}`,
							missingEnv: env.missing,
						};
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "actions": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				process.exit(1);
			}
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const skills = registry.list() as unknown as Array<
					Record<string, unknown>
				>;
				const skill = skills.find((s) => s.name === name);
				if (!skill) {
					console.error(`Error: Skill "${name}" not found`);
					process.exit(1);
				}
				const actions = skill.actions as
					| Array<Record<string, unknown>>
					| undefined;
				if (!actions || actions.length === 0) {
					console.log(`No actions declared for skill "${name}".`);
					break;
				}
				if (jsonOutput) {
					outputJson(actions, false);
				} else {
					for (const action of actions) {
						const actionName = action.name ?? "?";
						const desc = action.description ?? "";
						const params = Array.isArray(action.params)
							? (action.params as Array<Record<string, unknown>>)
							: [];
						const paramStr =
							params.length > 0
								? ` — params: ${params.map((p) => `${p.name}${p.required ? "*" : ""}:${p.type}`).join(", ")}`
								: "";
						console.log(`  ${actionName}: ${desc}${paramStr}`);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "install": {
			const skillPath = positional[0];
			if (!skillPath) {
				console.error("Error: Path to skill directory is required");
				process.exit(1);
			}
			// Validate locally before installing
			const { SkillRegistry } = await import("./skill_registry");
			const registry = new SkillRegistry();
			const { isPackagedSkillDir, loadPackagedSkillDir } = await import(
				"./skill_yaml"
			);
			const { validateManifest } = await import("./skill_registry");

			if (!isPackagedSkillDir(skillPath)) {
				console.error(
					`Error: "${skillPath}" is not a packaged skill directory (missing skill.yaml)`,
				);
				process.exit(1);
			}

			const meta = loadPackagedSkillDir(skillPath);
			if (!meta) {
				console.error(`Error: Failed to load skill.yaml from "${skillPath}"`);
				process.exit(1);
			}

			const validation = validateManifest(meta.manifest);
			if (!validation.valid) {
				console.error(`Validation failed:`);
				for (const err of validation.errors) {
					console.error(`  - ${err}`);
				}
				process.exit(1);
			}

			const skillsDir = getSkillsDataDir();
			const result = registry.installSkill(skillPath, skillsDir);
			if (!result.success) {
				console.error(`Install failed: ${result.error}`);
				process.exit(1);
			}
			console.log(`Skill "${result.name}" installed to ${skillsDir}`);
			break;
		}

		case "validate": {
			const nameOrPath = positional[0];
			if (!nameOrPath) {
				console.error("Error: Skill name or path is required");
				process.exit(1);
			}

			const { isPackagedSkillDir, loadPackagedSkillDir } = await import(
				"./skill_yaml"
			);
			const { validateManifest } = await import("./skill_registry");

			// Check if it's a path to a packaged skill
			if (isPackagedSkillDir(nameOrPath)) {
				const meta = loadPackagedSkillDir(nameOrPath);
				if (!meta) {
					console.error(
						`Error: Failed to load skill.yaml from "${nameOrPath}"`,
					);
					process.exit(1);
				}
				const validation = validateManifest(meta.manifest);
				outputJson(validation, !jsonOutput);
				break;
			}

			// Check if it's a registered skill name (local registry)
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const skills = registry.list() as unknown as Array<
					Record<string, unknown>
				>;
				const skill = skills.find((s) => s.name === nameOrPath);
				if (!skill) {
					console.error(
						`Error: Skill "${nameOrPath}" not found (not a path or registered name)`,
					);
					process.exit(1);
				}
				const validation = validateManifest(
					skill as unknown as import("./skill").SkillManifest,
				);
				outputJson(validation, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "remove": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				process.exit(1);
			}
			const { SkillRegistry } = await import("./skill_registry");
			const registry = new SkillRegistry();
			const skillsDir = getSkillsDataDir();
			const result = registry.removeSkill(name, skillsDir);
			if (!result.success) {
				console.error(`Remove failed: ${result.error}`);
				process.exit(1);
			}
			console.log(`Skill "${name}" removed.`);
			break;
		}

		default:
			console.error(`Unknown skill command: ${subcommand}`);
			process.exit(1);
	}
}

async function handleReport(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const [{ Telemetry }, { getReportsDir }] = await Promise.all([
		import("./runtime/telemetry"),
		import("./shared/paths"),
	]);

	switch (subcommand) {
		case "generate": {
			try {
				const telemetry = new Telemetry();
				const summary = telemetry.getSummary();
				const reportPath = telemetry.saveReport("json");
				console.log(`Report generated: ${reportPath}`);
				outputJson(summary, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "view": {
			try {
				const reportsDir = getReportsDir();
				if (!fs.existsSync(reportsDir)) {
					console.log("No reports found");
					break;
				}

				const files = fs
					.readdirSync(reportsDir)
					.filter((f) => f.endsWith(".json"))
					.sort()
					.reverse();

				if (files.length === 0) {
					console.log("No reports found");
					break;
				}

				const latestFile = files[0];
				const content = fs.readFileSync(
					path.join(reportsDir, latestFile),
					"utf8",
				);
				const parsed = JSON.parse(content);
				outputJson(parsed, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown report command: ${subcommand}`);
			process.exit(1);
	}
}

async function handleCaptcha(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const { loadConfig } = await import("./shared/config");

	if (subcommand !== "test") {
		console.error(`Unknown captcha command: ${subcommand}`);
		process.exit(1);
	}

	// Captcha solving requires a browser Page which the CLI cannot provide.
	// Validate configuration instead of pretending to solve.
	const config = loadConfig({ validate: false });
	if (!config.captchaProvider) {
		console.error(
			"Error: CAPTCHA_PROVIDER is not configured. Set it in .env to enable captcha solving.",
		);
		process.exit(1);
	}
	if (!config.captchaApiKey) {
		console.error("Error: CAPTCHA_API_KEY is not configured.");
		process.exit(1);
	}

	const result = {
		provider: config.captchaProvider,
		timeoutMs: config.captchaTimeoutMs,
		status: "configured",
		note: "Captcha solving requires a browser page context. Use the programmatic API or daemon to solve captchas at runtime.",
	};
	outputJson(result, !jsonOutput);
}

async function handlePolicy(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const {
		listBuiltInProfiles,
		listCustomProfiles,
		getProfile,
		serializeProfile,
		deserializeProfile,
		validateProfile,
		saveCustomProfile,
	} = await import("./policy/profiles");

	switch (subcommand) {
		case "list": {
			const builtIn = listBuiltInProfiles();
			const custom = listCustomProfiles();
			const result = {
				builtIn: builtIn.map((p) => p.name),
				custom: custom.map((p) => p.name),
			};
			outputJson(result, !jsonOutput);
			break;
		}

		case "inspect": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Profile name is required");
				process.exit(1);
			}
			const profile = getProfile(name);
			if (!profile) {
				console.error(`Error: Profile "${name}" not found`);
				process.exit(1);
			}
			outputJson(profile, !jsonOutput);
			break;
		}

		case "export": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Profile name is required");
				process.exit(1);
			}
			const profile = getProfile(name);
			if (!profile) {
				console.error(`Error: Profile "${name}" not found`);
				process.exit(1);
			}

			const outputPath = positional[1] || `${name}-policy.json`;
			const serialized = serializeProfile(profile);
			fs.writeFileSync(outputPath, serialized, "utf-8");
			console.log(`Profile exported to: ${outputPath}`);
			break;
		}

		case "import": {
			const filePath = positional[0];
			if (!filePath) {
				console.error("Error: File path is required");
				process.exit(1);
			}

			if (!fs.existsSync(filePath)) {
				console.error(`Error: File not found: ${filePath}`);
				process.exit(1);
			}

			const content = fs.readFileSync(filePath, "utf-8");
			const profile = deserializeProfile(content);
			if (!profile) {
				console.error("Error: Failed to parse profile or validation failed");
				process.exit(1);
			}

			const validation = validateProfile(profile);
			if (!validation.valid) {
				console.error("Validation failed:");
				for (const err of validation.errors) {
					console.error(`  - ${err}`);
				}
				process.exit(1);
			}

			saveCustomProfile(profile);
			outputJson(profile, !jsonOutput);
			if (!jsonOutput) {
				console.log(
					`Profile "${profile.name}" imported and saved successfully`,
				);
			}
			break;
		}

		default:
			console.error(`Unknown policy command: ${subcommand}`);
			process.exit(1);
	}
}

async function handleBrowser(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	switch (subcommand) {
		case "attach": {
			// Section 27: Support --cdp and --endpoint aliases
			const port = flags.port ? Number(flags.port) : undefined;
			const cdpUrl =
				flags.cdp ?? flags.endpoint ?? flags["cdp-url"] ?? undefined;
			const targetType = (flags["target-type"] ?? "chrome") as
				| "chrome"
				| "chromium"
				| "msedge"
				| "electron"
				| "unknown";
			const provider = flags.provider ?? undefined;
			const confirmed = flags.yes === "true" || flags.confirm === "true";

			try {
				const { BrowserConnectionManager } = await import(
					"./browser/connection"
				);
				const { loadConfig } = await import("./shared/config");
				const { DefaultPolicyEngine } = await import("./policy/engine");

				const config = loadConfig({ validate: false });
				const policyEngine = new DefaultPolicyEngine({
					profileName: config.policyProfile,
				});
				const manager = new BrowserConnectionManager({ policyEngine });

				const connection = await manager.attach({
					port,
					cdpUrl,
					targetType,
					actor: "human",
					provider,
					confirmed,
				});
				if (jsonOutput) {
					outputJson(connection);
				} else {
					console.log(`Attached to ${connection.targetType} browser`);
					console.log(`  Mode:     ${connection.mode}`);
					console.log(`  Endpoint: ${connection.cdpEndpoint}`);
					console.log(`  Tabs:     ${connection.tabCount}`);
					console.log(`  Status:   ${connection.status}`);
				}
				await manager.releaseCliHandles();
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		// Section 27: Browser discovery and attach UX
		case "list": {
			const all = flags.all === "true";
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const result = await bc.browser.list({ all });
				if (jsonOutput) {
					outputJson(result);
				} else {
					if (!result.success) {
						console.error(`List failed: ${result.error}`);
						process.exit(1);
					}
					const browsers = result.data ?? [];
					if (browsers.length === 0) {
						console.log("No attachable browsers found.");
					} else {
						console.log(`Found ${browsers.length} attachable browser(s):`);
						for (const b of browsers) {
							const marker = b.attached ? " (attached)" : "";
							console.log(`  ${b.channel}${marker}`);
							console.log(`    Endpoint: ${b.endpoint}`);
							if (b.title) console.log(`    Title: ${b.title}`);
							if (b.pid) console.log(`    PID: ${b.pid}`);
						}
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		// Section 27: Clean detach
		case "detach": {
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const result = await bc.browser.detach();
				if (jsonOutput) {
					outputJson(result);
				} else {
					if (!result.success || !result.data) {
						console.error(`Detach failed: ${result.error ?? "not applicable"}`);
						process.exit(1);
					}
					if (result.data.detached) {
						console.log(`Detached from browser`);
						console.log(`  Ownership: ${result.data.ownership}`);
						console.log(`  Closed browser: ${result.data.closedBrowser}`);
						if (result.data.endpoint)
							console.log(`  Endpoint: ${result.data.endpoint}`);
					} else {
						console.log(
							`Detach failed or not applicable (mode: ${result.data.ownership})`,
						);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		// Section 27: File/data drop
		case "drop": {
			const target = positional[0];
			// Support both --file and --files for compatibility
			const fileValues = [flags.file, flags.files].filter(
				(value): value is string => Boolean(value),
			);
			const filesRaw =
				fileValues.length > 0 ? fileValues.join("\0") : undefined;
			const dataRaw = flags.data;
			// Split on null character delimiter for repeated flags
			const files = filesRaw
				? filesRaw.split("\0").map((f) => f.trim())
				: undefined;
			const dataArray = dataRaw
				? dataRaw.split("\0").map((d) => d.trim())
				: undefined;

			if (!target) {
				console.error("Error: Target is required");
				process.exit(1);
			}
			if (!files && !dataArray) {
				console.error("Error: Either --file/--files or --data is required");
				process.exit(1);
			}

			try {
				const { createBrowserControl } = await import("./browser_control");
				const { loadConfig } = await import("./shared/config");

				const config = loadConfig({ validate: false });
				const bc = createBrowserControl({
					policyProfile: config.policyProfile,
				});

				// Parse data if provided (format: mimeType=value, split on first = only)
				const parsedData = dataArray?.map((d: string) => {
					const eqIndex = d.indexOf("=");
					if (eqIndex === -1) {
						// If no =, treat entire string as value with default MIME type
						return { mimeType: "text/plain", value: d };
					}
					const mimeType = d.slice(0, eqIndex);
					const value = d.slice(eqIndex + 1);
					return { mimeType, value };
				});

				const result = await bc.browser.drop({
					target,
					files,
					data: parsedData,
				});

				if (jsonOutput) {
					outputJson(result);
				} else {
					if (result.success) {
						console.log(`Drop successful`);
						if (result.data?.files) {
							console.log(`  Files dropped: ${result.data.files.length}`);
							for (const f of result.data.files) {
								console.log(`    ${f.path} (${f.sizeBytes} bytes)`);
							}
						}
						if (result.data?.data) {
							console.log(`  Data items dropped: ${result.data.data.length}`);
							for (const d of result.data.data) {
								console.log(
									`    ${d.mimeType}: ${d.value.substring(0, 50)}${d.value.length > 50 ? "..." : ""}`,
								);
							}
						}
					} else {
						console.error(`Drop failed: ${result.error}`);
						process.exit(1);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		// Section 27: Downloads list
		case "downloads": {
			const downloadsAction = positional[0];
			if (downloadsAction !== "list") {
				console.error(`Unknown downloads command: ${downloadsAction}`);
				console.error("Available: list");
				process.exit(1);
			}

			try {
				const { createBrowserControl } = await import("./browser_control");
				const { loadConfig } = await import("./shared/config");

				const config = loadConfig({ validate: false });
				const bc = createBrowserControl({
					policyProfile: config.policyProfile,
				});

				const result = await bc.browser.downloads.list();

				if (jsonOutput) {
					outputJson(result);
				} else {
					if (result.success) {
						console.log(`Downloads: ${result.data?.length ?? 0}`);
						if (result.data && result.data.length > 0) {
							for (const d of result.data) {
								console.log(`  ${d.suggestedFilename ?? d.path}`);
								if (d.path) console.log(`    Path: ${d.path}`);
								if (d.sizeBytes) console.log(`    Size: ${d.sizeBytes} bytes`);
								console.log(`    Status: ${d.status}`);
							}
						}
					} else {
						console.error(`Downloads list failed: ${result.error}`);
						process.exit(1);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "launch": {
			const port = flags.port ? Number(flags.port) : undefined;
			const profileName = flags.profile ?? "default";
			const provider = flags.provider ?? undefined;

			try {
				const { BrowserConnectionManager } = await import(
					"./browser/connection"
				);
				const { loadConfig } = await import("./shared/config");
				const { DefaultPolicyEngine } = await import("./policy/engine");

				const config = loadConfig({ validate: false });
				const policyEngine = new DefaultPolicyEngine({
					profileName: config.policyProfile,
				});
				const manager = new BrowserConnectionManager({ policyEngine });

				const connection = await manager.launchManaged({
					port,
					profileName,
					actor: "human",
					provider,
				});
				if (jsonOutput) {
					outputJson(connection);
				} else {
					console.log(`Managed browser connected`);
					console.log(`  Mode:     ${connection.mode}`);
					console.log(
						`  Profile:  ${connection.profile.name} (${connection.profile.type})`,
					);
					console.log(`  Endpoint: ${connection.cdpEndpoint}`);
					console.log(`  Tabs:     ${connection.tabCount}`);
				}
				await manager.releaseCliHandles();
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "status": {
			try {
				const { MemoryStore } = await import("./runtime/memory_store");
				const store = new MemoryStore();
				const rawConnectionState = store.get<Record<string, unknown>>(
					"browser_connection:active",
				);
				const connectionState = rawConnectionState
					? await normalizePersistedBrowserStatus(rawConnectionState, store)
					: null;
				store.close();
				if (!connectionState) {
					console.log(
						jsonOutput
							? '{"connected":false}'
							: "No active browser connection.",
					);
				} else {
					outputJson(connectionState, !jsonOutput);
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "provider": {
			const providerAction = positional[0];
			switch (providerAction) {
				case "list": {
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const result = registry.list();
					if (jsonOutput) {
						outputJson(result);
					} else {
						console.log(`Active provider: ${result.activeProvider}`);
						console.log("Built-in providers:");
						for (const name of result.builtIn) {
							const marker = name === result.activeProvider ? " (active)" : "";
							console.log(`  ${name}${marker}`);
						}
						if (result.providers.length > 0) {
							console.log("Custom providers:");
							for (const p of result.providers) {
								const marker =
									p.name === result.activeProvider ? " (active)" : "";
								console.log(`  ${p.name} (${p.type})${marker}`);
							}
						}
					}
					break;
				}
				case "use": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						process.exit(1);
					}
					await requireCliPolicy("browser_provider_use", { name }, jsonOutput);
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const result = registry.select(name);
					if (jsonOutput) {
						outputJson(result);
					} else {
						if (result.success) {
							console.log(`Active provider set to "${name}"`);
							if (result.previousProvider && result.previousProvider !== name) {
								console.log(`  (was: ${result.previousProvider})`);
							}
						} else {
							console.error(`Error: ${result.error}`);
							process.exit(1);
						}
					}
					break;
				}
				case "add": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						process.exit(1);
					}
					const providerType = flags.type as ProviderConfig["type"] | undefined;
					const endpoint = flags.endpoint as string | undefined;
					const apiKey = flags["api-key"] as string | undefined;
					if (!providerType) {
						console.error("Error: --type is required (browserless, custom)");
						process.exit(1);
					}
					if (providerType !== "browserless" && providerType !== "custom") {
						console.error(
							`Error: Invalid provider type "${providerType}". Must be browserless or custom.`,
						);
						process.exit(1);
					}
					if (!endpoint) {
						console.error("Error: --endpoint is required");
						process.exit(1);
					}
					await requireCliPolicy(
						"browser_provider_add",
						{ name, type: providerType, endpoint },
						jsonOutput,
					);
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const config: ProviderConfig = {
						name,
						type: providerType,
						endpoint,
					};
					if (apiKey) config.apiKey = apiKey;
					const result = registry.add(config);
					if (jsonOutput) {
						outputJson(result);
					} else {
						if (result.success) {
							console.log(`Provider "${name}" added (${providerType})`);
							if (apiKey) console.log("  API key stored (not shown)");
						} else {
							console.error(`Error: ${result.error}`);
							process.exit(1);
						}
					}
					break;
				}
				case "remove": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						process.exit(1);
					}
					await requireCliPolicy(
						"browser_provider_remove",
						{ name },
						jsonOutput,
					);
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const result = registry.remove(name);
					if (jsonOutput) {
						outputJson(result);
					} else {
						if (result.success) {
							console.log(`Provider "${name}" removed`);
						} else {
							console.error(`Error: ${result.error}`);
							process.exit(1);
						}
					}
					break;
				}
				default:
					console.error(`Unknown browser provider command: ${providerAction}`);
					console.error("Available: list, use, add, remove");
					process.exit(1);
			}
			break;
		}

		case "profile": {
			// Nested subcommand: args.positional[0] = profile action, positional[1+] = args
			const profileAction = positional[0];

			switch (profileAction) {
				case "list": {
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const profiles = pm.listProfiles();
					if (jsonOutput) {
						outputJson(profiles, false);
					} else {
						if (profiles.length === 0) {
							console.log("No profiles.");
						} else {
							for (const p of profiles) {
								const marker =
									p.type === "shared"
										? " (shared)"
										: p.type === "isolated"
											? " (isolated)"
											: "";
								console.log(
									`  ${p.name}${marker} — last used: ${p.lastUsedAt}`,
								);
							}
						}
					}
					break;
				}

				case "create": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Profile name is required");
						process.exit(1);
					}
					const type = (flags.type ?? "named") as
						| "shared"
						| "isolated"
						| "named";
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const profile = pm.createProfile(name, type);
					if (jsonOutput) {
						outputJson(profile, false);
					} else {
						console.log(
							`Profile "${profile.name}" created (type: ${profile.type})`,
						);
						console.log(`  Data dir: ${profile.dataDir}`);
					}
					break;
				}

				case "use": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Profile name is required");
						process.exit(1);
					}
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const profile = pm.getProfileByName(name);
					if (!profile) {
						console.error(`Error: Profile "${name}" not found`);
						process.exit(1);
					}
					pm.touchProfile(profile.id);
					// Store the active profile preference
					const { MemoryStore } = await import("./runtime/memory_store");
					const store = new MemoryStore();
					store.set("browser_connection:active_profile", {
						id: profile.id,
						name: profile.name,
					});
					store.close();
					if (jsonOutput) {
						outputJson(profile, false);
					} else {
						console.log(
							`Active profile set to "${profile.name}" (${profile.type})`,
						);
					}
					break;
				}

				case "delete": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Profile name is required");
						process.exit(1);
					}
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const deleted = pm.deleteProfileByName(name);
					if (!deleted) {
						console.error(
							`Error: Profile "${name}" not found or cannot be deleted`,
						);
						process.exit(1);
					}
					console.log(`Profile "${name}" deleted.`);
					break;
				}

				default:
					console.error(`Unknown browser profile command: ${profileAction}`);
					console.error("Available: list, create, use, delete");
					process.exit(1);
			}
			break;
		}

		case "auth": {
			const authAction = positional[0];

			switch (authAction) {
				case "export": {
					const profileName = flags.profile;
					const outputFile =
						flags.output ??
						positional[1] ??
						`${profileName ?? "default"}-auth.json`;
					const isLive = Boolean(flags.live);
					const isStored = Boolean(flags.stored);
					const confirmed = flags.yes === "true" || flags.confirm === "true";

					if (!isLive && !isStored) {
						console.error(
							"Error: You must specify either --live (to extract from the active browser) or --stored (to extract from offline memory snapshot).",
						);
						process.exit(1);
					}
					if (isLive && isStored) {
						console.error("Error: Cannot specify both --live and --stored.");
						process.exit(1);
					}

					await requireCliPolicy(
						"browser_auth_export",
						{
							profileName: profileName ?? "default",
							outputFile,
							live: isLive,
							stored: isStored,
						},
						jsonOutput,
						confirmed,
					);

					try {
						const { BrowserProfileManager } = await import(
							"./browser/profiles"
						);
						const { BrowserConnectionManager } = await import(
							"./browser/connection"
						);
						const { loadAuthSnapshot } = await import("./browser/auth_state");
						const { loadConfig } = await import("./shared/config");
						const { DefaultPolicyEngine } = await import("./policy/engine");
						const { MemoryStore } = await import("./runtime/memory_store");

						const config = loadConfig({ validate: false });
						const policyEngine = new DefaultPolicyEngine({
							profileName: confirmed ? "trusted" : config.policyProfile,
						});
						const manager = new BrowserConnectionManager({ policyEngine });
						const pm = new BrowserProfileManager();
						const store = new MemoryStore();
						const activeSession = store.get<StoredBrowserConnectionState>(
							"browser_connection:active",
						);

						let snapshot = null;

						if (isLive) {
							if (!activeSession || activeSession.status !== "connected") {
								store.close();
								console.error(
									"Error: --live was specified but no active browser is currently connected.",
								);
								process.exit(1);
							}
							const activeProfileId = activeSession.profileId;
							if (!activeProfileId) {
								store.close();
								console.error(
									"Error: Active browser state is missing a profile id.",
								);
								process.exit(1);
							}
							const activeProfileName = pm.getProfile(activeProfileId)?.name;

							if (profileName && profileName !== activeProfileName) {
								store.close();
								console.error(
									`Error: Active browser is running profile "${activeProfileName}", but you requested "${profileName}".`,
								);
								process.exit(1);
							}

							let activePort = config.chromeDebugPort;
							if (activeSession.cdpEndpoint?.includes(":")) {
								const url = new URL(activeSession.cdpEndpoint);
								activePort = parseInt(url.port, 10);
							}

							console.log(
								`Connecting to active browser for profile "${activeProfileName}" on port ${activePort}...`,
							);
							const reconnected = await manager.reconnectActiveManaged();
							if (!reconnected) {
								await manager.attach({
									port: activePort,
									targetType: activeSession.targetType,
									actor: "human",
								});
							}
							snapshot = await manager.exportAuth();
							await manager.releaseCliHandles();
							console.log(
								`Successfully extracted live auth state from running browser.`,
							);
						} else {
							const targetProfileName = profileName ?? "default";
							const profile = pm.getProfileByName(targetProfileName);
							if (!profile) {
								store.close();
								console.error(
									`Error: Profile "${targetProfileName}" not found`,
								);
								process.exit(1);
							}
							snapshot = loadAuthSnapshot(store, profile.id);
							if (!snapshot) {
								store.close();
								console.error(
									`No saved auth state for profile "${targetProfileName}".`,
								);
								console.error(
									"Connect to a browser first and let cookies persist, then try again.",
								);
								process.exit(1);
							}
							console.log(
								`Successfully loaded stored auth snapshot for profile "${targetProfileName}".`,
							);
						}

						store.close();
						fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
						console.log(`Auth state saved to: ${outputFile}`);
						console.log(`  Cookies: ${snapshot.cookies.length}`);
						console.log(
							`  localStorage domains: ${Object.keys(snapshot.localStorage).length}`,
						);
					} catch (error) {
						console.error("Error:", (error as Error).message);
						process.exit(1);
					}
					break;
				}

				case "import": {
					const filePath = positional[1];
					const profileName = flags.profile;
					const isLive = Boolean(flags.live);
					const isStored = Boolean(flags.stored);
					const confirmed = flags.yes === "true" || flags.confirm === "true";

					if (!filePath) {
						console.error("Error: File path is required");
						process.exit(1);
					}
					if (!fs.existsSync(filePath)) {
						console.error(`Error: File not found: ${filePath}`);
						process.exit(1);
					}
					if (!isLive && !isStored) {
						console.error(
							"Error: You must specify either --live (to inject into the active browser) or --stored (to update offline memory snapshot).",
						);
						process.exit(1);
					}
					if (isLive && isStored) {
						console.error("Error: Cannot specify both --live and --stored.");
						process.exit(1);
					}

					await requireCliPolicy(
						"browser_auth_import",
						{
							filePath,
							profileName,
							live: isLive,
							stored: isStored,
						},
						jsonOutput,
						confirmed,
					);

					try {
						const content = fs.readFileSync(filePath, "utf-8");
						const snapshot = JSON.parse(content);
						const { BrowserProfileManager } = await import(
							"./browser/profiles"
						);
						const { BrowserConnectionManager } = await import(
							"./browser/connection"
						);
						const { saveAuthSnapshotToStore } = await import(
							"./browser/auth_state"
						);
						const { loadConfig } = await import("./shared/config");
						const { DefaultPolicyEngine } = await import("./policy/engine");
						const { MemoryStore } = await import("./runtime/memory_store");

						const config = loadConfig({ validate: false });
						const policyEngine = new DefaultPolicyEngine({
							profileName: confirmed ? "trusted" : config.policyProfile,
						});
						const manager = new BrowserConnectionManager({ policyEngine });
						const pm = new BrowserProfileManager();
						let profileId = snapshot.profileId ?? "default";
						if (profileName) {
							const profile = pm.getProfileByName(profileName);
							if (!profile) {
								console.error(`Error: Profile "${profileName}" not found`);
								process.exit(1);
							}
							profileId = profile.id;
						}
						const targetSnapshot = { ...snapshot, profileId };

						const store = new MemoryStore();

						if (isLive) {
							const activeSession = store.get<StoredBrowserConnectionState>(
								"browser_connection:active",
							);
							if (!activeSession || activeSession.status !== "connected") {
								store.close();
								console.error(
									"Error: --live was specified but no active browser is currently connected.",
								);
								process.exit(1);
							}
							if (activeSession.profileId !== profileId) {
								store.close();
								console.error(
									`Error: Active browser is running profile "${activeSession.profileId}", but snapshot is for "${profileId}".`,
								);
								process.exit(1);
							}

							let activePort = config.chromeDebugPort;
							if (activeSession.cdpEndpoint?.includes(":")) {
								const url = new URL(activeSession.cdpEndpoint);
								activePort = parseInt(url.port, 10);
							}

							console.log(
								`Connecting to active browser for profile "${profileId}" on port ${activePort}...`,
							);
							const reconnected = await manager.reconnectActiveManaged();
							if (!reconnected) {
								await manager.attach({
									port: activePort,
									targetType: activeSession.targetType,
									actor: "human",
								});
							}
							await manager.importAuth(targetSnapshot);
							await manager.releaseCliHandles();
							console.log(
								`Successfully injected auth state directly into live running browser context.`,
							);
						} else {
							// Store only
							saveAuthSnapshotToStore(store, profileId, targetSnapshot);
							console.log(
								`Stored offline auth snapshot updated for profile "${profileId}".`,
							);
							console.log(
								`  (Note: The browser was not affected. This will apply next time the profile is launched as a restored session.)`,
							);
						}

						store.close();
						console.log(`  Cookies: ${targetSnapshot.cookies?.length ?? 0}`);
					} catch (error) {
						console.error("Error:", (error as Error).message);
						process.exit(1);
					}
					break;
				}

				default:
					console.error(`Unknown browser auth command: ${authAction}`);
					console.error("Available: export, import");
					process.exit(1);
			}
			break;
		}

		case "highlight": {
			const target = positional[0];
			if (!target) {
				console.error("Error: Target (ref, selector, or text) is required");
				process.exit(1);
			}
			await requireCliPolicy(
				"browser_highlight",
				{ target },
				jsonOutput,
				flags.yes === "true" || flags.confirm === "true",
			);
			try {
				const { createBrowserControl } = await import("./browser_control");
				const { formatActionResult } = await import("./shared/action_result");
				const bc = createBrowserControl();
				const result = await bc.browser.highlight({
					target,
					style: flags.style,
					persist: flags.persist === "true",
					hide: flags.hide === "true",
				});
				if (jsonOutput) {
					outputJson(formatActionResult(result), false);
				} else {
					if (result.success) {
						console.log(`Highlighted: ${target}`);
						if (result.warning) console.warn(`Warning: ${result.warning}`);
					} else {
						console.error(`Error: ${result.error}`);
						if (result.policyDecision)
							console.error(`Policy: ${result.policyDecision}`);
						process.exit(1);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown browser command: ${subcommand}`);
			console.error(
				"Available: attach, launch, status, profile, auth, highlight",
			);
			process.exit(1);
	}
}

export async function runCli(argv = process.argv): Promise<void> {
	const args = parseArgs(argv);

	if (args.flags.help || args.flags.h || args.command === "help") {
		printHelp();
		return;
	}

	if (!args.command) {
		printHelp();
		return;
	}

	const previousJsonOutputMode = process.env.BROWSER_CONTROL_JSON_OUTPUT;
	if (args.flags.json === "true") {
		process.env.BROWSER_CONTROL_JSON_OUTPUT = "true";
		installJsonOutputGuards();
	}

	switch (args.command) {
		case "doctor":
			await handleDoctor(args);
			break;

		case "setup":
			await handleSetup(args);
			break;

		case "config":
			await handleConfig(args);
			break;

		case "status":
			await handleStatus(args);
			break;

		case "data":
			await handleData(args);
			break;

		case "benchmark":
			await handleBenchmark(args);
			break;

		case "dashboard":
			await handleDashboard(args);
			break;

		case "web":
		case "app":
			await handleWeb(args);
			break;

		case "desktop":
			await handleDesktop(args);
			break;

		case "workflow":
			await handleWorkflow(args);
			break;

		case "harness":
			await handleHarness(args);
			break;

		case "package":
			await handlePackage(args);
			break;

		case "run":
			await handleRun(args);
			break;

		case "schedule":
			await handleSchedule(args);
			break;

		case "daemon":
			await handleDaemon(args);
			break;

		case "proxy":
			await handleProxy(args);
			break;

		case "memory":
			await handleMemory(args);
			break;

		case "skill":
			await handleSkill(args);
			break;

		case "report":
			await handleReport(args);
			break;

		case "captcha":
			await handleCaptcha(args);
			break;

		case "policy":
			await handlePolicy(args);
			break;

		// ── Top-level browser actions (Section 5) ─────────────────────
		case "open":
			await handleBrowserAction("open", args);
			break;

		case "snapshot":
			await handleBrowserAction("snapshot", args);
			break;

		case "click":
			await handleBrowserAction("click", args);
			break;

		case "fill":
			await handleBrowserAction("fill", args);
			break;

		case "hover":
			await handleBrowserAction("hover", args);
			break;

		case "type":
			await handleBrowserAction("type", args);
			break;

		case "press":
			await handleBrowserAction("press", args);
			break;

		case "scroll":
			await handleBrowserAction("scroll", args);
			break;

		case "screenshot":
			await handleBrowserAction("screenshot", args);
			break;

		case "tab":
			await handleBrowserAction("tab", args);
			break;

		case "close":
			await handleBrowserAction("close", args);
			break;

		case "locator":
			await handleLocator(args);
			break;

		// ── Session commands (Section 5) ────────────────────────────────
		case "session":
			await handleSession(args);
			break;

		case "browser":
			await handleBrowser(args);
			break;

		case "knowledge":
			await handleKnowledge(args);
			break;

		case "term":
			await handleTerm(args);
			break;

		case "fs":
			await handleFs(args);
			break;

		case "service":
			await handleService(args);
			break;

		case "debug":
			await handleDebug(args);
			break;

		// ── MCP Server (Section 7) ──────────────────────────────────────
		case "mcp":
			await handleMcp(args);
			break;

		default:
			console.error(`Unknown command: ${args.command}`);
			printHelp();
			process.exit(1);
	}

	// ── Clean exit ──────────────────────────────────────────────────
	// Close the shared SessionManager to release all held resources
	// (MemoryStore's SQLite handle, terminal manager, etc.). Without
	// this, the Node.js event loop stays alive and the CLI process
	// never exits after commands like `bc term open --json`.
	if (_sessionManager) {
		await _sessionManager.releaseCliHandles();
		_sessionManager.close();
	}

	if (previousJsonOutputMode === undefined) {
		delete process.env.BROWSER_CONTROL_JSON_OUTPUT;
	} else {
		process.env.BROWSER_CONTROL_JSON_OUTPUT = previousJsonOutputMode;
	}
}

// ── Knowledge Handler (Section 9) ──────────────────────────────────

async function handleKnowledge(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const {
		listAllKnowledge,
		listByKind,
		findByDomain,
		findByName,
		deleteArtifact,
		pruneArtifact,
		loadArtifact,
	} = await import("./knowledge/store");
	const { getKnowledgeStats } = await import("./knowledge/query");
	const { validateArtifact } = await import("./knowledge/validator");

	switch (subcommand) {
		case "list": {
			const kindFilter = flags.kind as string | undefined;
			const summaries =
				kindFilter && isKnowledgeKind(kindFilter)
					? listByKind(kindFilter)
					: kindFilter
						? []
						: listAllKnowledge();

			if (jsonOutput) {
				outputJson(summaries, false);
			} else {
				if (summaries.length === 0) {
					console.log("No knowledge artifacts found.");
					break;
				}
				console.log(`Knowledge artifacts (${summaries.length}):\n`);
				for (const s of summaries) {
					const verified = s.verified ? " [verified]" : "";
					const tags = s.tags.length > 0 ? ` tags=[${s.tags.join(", ")}]` : "";
					console.log(
						`  ${s.kind.padEnd(18)} ${s.identifier.padEnd(30)} ${s.entryCount} entries${verified}${tags}`,
					);
				}
				const stats = getKnowledgeStats();
				console.log(
					`\nTotal: ${stats.totalFiles} files, ${stats.totalEntries} entries (${stats.verifiedEntries} verified)`,
				);
			}
			break;
		}

		case "show": {
			const nameOrDomain = positional[0];
			if (!nameOrDomain) {
				console.error("Error: Name or domain is required");
				process.exit(1);
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				process.exit(1);
			}

			if (jsonOutput) {
				outputJson(
					{
						frontmatter: artifact.frontmatter,
						entries: artifact.entries,
						sections: Object.keys(artifact.sections),
					},
					true,
				);
			} else {
				console.log(`Kind:       ${artifact.frontmatter.kind}`);
				if (artifact.frontmatter.domain)
					console.log(`Domain:     ${artifact.frontmatter.domain}`);
				if (artifact.frontmatter.name)
					console.log(`Name:       ${artifact.frontmatter.name}`);
				console.log(`Captured:   ${artifact.frontmatter.capturedAt}`);
				if (artifact.frontmatter.updatedAt)
					console.log(`Updated:    ${artifact.frontmatter.updatedAt}`);
				console.log(`Verified:   ${artifact.frontmatter.verified ?? false}`);
				console.log(`Entries:    ${artifact.entries.length}`);
				console.log(`File:       ${artifact.filePath}`);

				if (artifact.entries.length > 0) {
					console.log(`\nEntries:`);
					for (const entry of artifact.entries) {
						const verifiedTag = entry.verified ? " [verified]" : "";
						console.log(`  [${entry.type}] ${entry.description}${verifiedTag}`);
						if (entry.selector) console.log(`    selector: ${entry.selector}`);
						if (entry.waitCondition)
							console.log(
								`    waitCondition: ${entry.waitCondition} (${entry.waitMs ?? "?"}ms)`,
							);
					}
				}

				console.log(`\nBody preview:`);
				const preview = artifact.body.split("\n").slice(0, 20).join("\n");
				console.log(preview);
				if (artifact.body.split("\n").length > 20) {
					console.log("... (truncated)");
				}
			}
			break;
		}

		case "validate": {
			const all = listAllKnowledge();
			if (all.length === 0) {
				console.log("No knowledge artifacts to validate.");
				break;
			}

			let allValid = true;
			const results: ValidationResult[] = [];

			for (const summary of all) {
				const artifact = loadArtifact(summary.filePath);
				if (!artifact) continue;

				const result = validateArtifact(artifact);
				results.push(result);

				if (!result.valid) allValid = false;

				if (!jsonOutput) {
					const status = result.valid ? "VALID" : "INVALID";
					const issueCount = result.issues.length;
					console.log(
						`  ${status.padEnd(8)} ${summary.identifier.padEnd(30)} ${issueCount} issue(s)`,
					);
					for (const issue of result.issues) {
						const prefix = issue.severity === "error" ? "  ERROR" : "  WARN ";
						const line = issue.line ? ` (line ${issue.line})` : "";
						console.log(`    ${prefix}: ${issue.message}${line}`);
					}
				}
			}

			if (jsonOutput) {
				outputJson(results, true);
			} else {
				console.log(`\n${allValid ? "All valid." : "Some files have issues."}`);
			}

			if (!allValid) process.exit(1);
			break;
		}

		case "prune": {
			// Prune removes stale entries (not full delete)
			const nameOrDomain = positional[0];
			if (!nameOrDomain) {
				console.error("Error: Name or domain is required");
				process.exit(1);
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				process.exit(1);
			}

			const result = pruneArtifact(artifact.filePath, {
				maxAgeDays: 90,
				removeUnverified: false,
				removeFailed: true,
			});

			if (jsonOutput) {
				outputJson(result);
			} else {
				console.log(
					`Pruned ${result.removed} entries from ${result.kept} retained.`,
				);
				if (result.removed > 0) {
					console.log(`Updated: ${artifact.filePath}`);
				}
			}
			break;
		}

		case "delete": {
			// Full file delete (separate from prune)
			const nameOrDomain = positional[0];
			if (!nameOrDomain) {
				console.error("Error: Name or domain is required");
				process.exit(1);
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				process.exit(1);
			}

			const deleted = deleteArtifact(artifact.filePath);
			if (deleted) {
				console.log(`Deleted: ${artifact.filePath}`);
			} else {
				console.error(`Error: Failed to delete ${artifact.filePath}`);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown knowledge command: ${subcommand}`);
			console.error("Supported: list, show, validate, prune, delete");
			process.exit(1);
	}
}

// ── MCP Handler (Section 7) ───────────────────────────────────────────

async function handleMcp(args: ParsedArgs): Promise<void> {
	const { subcommand } = args;

	switch (subcommand) {
		case "serve": {
			const { startMcpServer } = await import("./mcp/server");
			await startMcpServer();
			break;
		}

		default:
			console.error(`Unknown MCP command: ${subcommand}`);
			console.error("Available: serve");
			process.exit(1);
	}
}

// ── Section 5 shared session manager singleton ────────────────────────

let _sessionManager: import("./session_manager").SessionManager | null = null;

/**
 * Ensure the daemon is running and reachable for terminal session commands.
 *
 * Delegates to SessionManager.ensureDaemonRuntime({ autoStart: true }), which
 * probes the daemon health endpoint and, if it's not running, auto-starts it
 * with retries.  This is the unified path used by both CLI and API.
 *
 * On success, returns the broker URL.  On failure, throws an error.
 */
async function ensureDaemonRunning(): Promise<string> {
	// Use or create the session manager singleton
	if (!_sessionManager) {
		const { SessionManager } = await import("./session_manager");
		_sessionManager = new SessionManager();
	}

	const established = await _sessionManager.ensureDaemonRuntime({
		autoStart: true,
	});
	if (!established) {
		throw new Error(
			`Failed to start or connect to the daemon for terminal session commands. ` +
				`Try manually: bc daemon start`,
		);
	}

	// Return the broker URL from the cached runtime
	const { loadConfig } = await import("./shared/config");
	const config = loadConfig({ validate: false });
	return `http://127.0.0.1:${config.brokerPort}`;
}

// ── Terminal Handlers (Section 5 — routed through action surface) ────

/**
 * Terminal subcommands that require a running daemon because they
 * manage persistent terminal sessions that must survive across
 * separate CLI invocations.
 */
const DAEMON_REQUIRED_TERM_COMMANDS = new Set([
	"open",
	"type",
	"read",
	"snapshot",
	"interrupt",
	"close",
	"list",
	"resume",
	"status",
	"view",
]);

export async function handleTerm(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const { SessionManager } = await import("./session_manager");
	const { TerminalActions } = await import("./terminal/actions");
	const { formatActionResult } = await import("./shared/action_result");

	// ── Terminal ownership model ──────────────────────────────────────
	// Terminal sessions must be owned by the long-lived daemon, NOT by
	// the short-lived CLI process.  This is the fix for the Section 5
	// terminal ownership defect:
	//
	//   - When the daemon is running, CLI term commands route through
	//     BrokerTerminalRuntime (HTTP to daemon's broker API).
	//     The PTY lives in the daemon process, so the CLI exits cleanly.
	//
	//   - When the daemon is NOT running, session-dependent commands
	//     (open, type, read, etc.) return an error telling the user to
	//     start the daemon first.  One-shot "term exec" (no --session)
	//     still works locally because it doesn't create persistent PTYs.

	const needsDaemon =
		DAEMON_REQUIRED_TERM_COMMANDS.has(subcommand ?? "") ||
		(subcommand === "exec" && Boolean(flags.session));

	if (needsDaemon) {
		// ── Terminal ownership model (Section 5 fix) ─────────────────
		// Terminal sessions must be owned by the long-lived daemon, NOT
		// by the short-lived CLI process.  If the daemon isn't running,
		// auto-start it transparently so `bc term open` works without
		// the user needing to know about `bc daemon start`.
		//
		// The PTY lives in the daemon process; the CLI routes through
		// the SessionManager's broker-backed runtime (HTTP to daemon's
		// broker API), so the CLI exits cleanly after printing the result.
		//
		// ensureDaemonRunning() calls SessionManager.ensureDaemonRuntime({ autoStart: true }),
		// which probes the daemon health endpoint, auto-starts the daemon
		// if needed, and caches a BrokerTerminalRuntime on the SessionManager.
		// After this, _sessionManager.getTerminalRuntime() returns the
		// BrokerTerminalRuntime automatically.

		try {
			await ensureDaemonRunning();
		} catch (error) {
			const message =
				(error as Error).message ??
				`Failed to start the daemon for terminal session commands.`;
			if (jsonOutput) {
				outputJson(
					{
						success: false,
						error: message,
						completedAt: new Date().toISOString(),
					},
					false,
				);
			} else {
				console.error(`Error: ${message}`);
			}
			process.exit(1);
			return; // unreachable but helps type inference
		}
	}

	// Use or create a session manager singleton (same as browser actions).
	// After ensureDaemonRunning(), getTerminalRuntime() will return
	// the cached BrokerTerminalRuntime for daemon-backed sessions.
	if (!_sessionManager) {
		_sessionManager = new SessionManager();
	}

	const terminalActions = new TerminalActions({
		sessionManager: _sessionManager,
		// No explicit terminalRuntime needed — TerminalActions uses
		// sessionManager.getTerminalRuntime() which returns the correct
		// runtime (BrokerTerminalRuntime when daemon is running, or
		// LocalTerminalRuntime for one-shot exec).
	});

	try {
		let result: import("./shared/action_result").ActionResult | undefined;

		switch (subcommand) {
			case "open": {
				result = await terminalActions.open({
					shell: flags.shell,
					cwd: flags.cwd ?? process.env.INIT_CWD ?? process.cwd(),
					name: flags.name,
				});
				break;
			}

			case "exec": {
				const command = positional[0];
				if (!command) {
					console.error("Error: Command is required");
					process.exit(1);
				}
				result = await terminalActions.exec({
					command,
					sessionId: flags.session,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
				});
				break;
			}

			case "type": {
				const text = positional[0];
				const sessionId = flags.session;
				if (!text) {
					console.error("Error: Text is required");
					process.exit(1);
				}
				if (!sessionId) {
					console.error("Error: --session is required for 'term type'");
					process.exit(1);
				}
				result = await terminalActions.type({ text, sessionId });
				break;
			}

			case "read": {
				const sessionId = flags.session;
				if (!sessionId) {
					console.error("Error: --session is required for 'term read'");
					process.exit(1);
				}
				result = await terminalActions.read({
					sessionId,
					maxBytes: flags["max-bytes"] ? Number(flags["max-bytes"]) : undefined,
				});
				break;
			}

			case "snapshot": {
				const sessionId = flags.session;
				result = await terminalActions.snapshot({ sessionId });
				break;
			}

			case "interrupt": {
				const sessionId = flags.session;
				if (!sessionId) {
					console.error("Error: --session is required for 'term interrupt'");
					process.exit(1);
				}
				result = await terminalActions.interrupt({ sessionId });
				break;
			}

			case "close": {
				const sessionId = flags.session;
				if (!sessionId) {
					console.error("Error: --session is required for 'term close'");
					process.exit(1);
				}
				result = await terminalActions.close({ sessionId });
				break;
			}

			case "list": {
				result = await terminalActions.list();
				break;
			}

			case "resume": {
				const sessionId = positional[0] || flags.session;
				if (!sessionId) {
					console.error("Error: session ID is required for 'term resume'");
					process.exit(1);
				}
				result = await terminalActions.resume({ sessionId });
				break;
			}

			case "status": {
				const sessionId = positional[0] || flags.session;
				if (!sessionId) {
					console.error("Error: session ID is required for 'term status'");
					process.exit(1);
				}
				result = await terminalActions.status({ sessionId });
				break;
			}

			case "view": {
				const sessionId = positional[0] || flags.session;
				if (!sessionId) {
					console.error("Error: session ID is required for 'term view'");
					process.exit(1);
				}
				result = await terminalActions.snapshot({ sessionId });
				break;
			}

			default:
				console.error(`Unknown term command: ${subcommand}`);
				process.exit(1);
		}

		if (result) {
			if (jsonOutput) {
				outputJson(formatActionResult(result), false);
			} else {
				if (result.success) {
					// Human-friendly output per action type
					if (subcommand === "exec" && result.data) {
						const execData =
							result.data as import("./terminal/types").ExecResult;
						console.log(execData.stdout ?? "");
						if (execData.exitCode !== 0 && execData.stderr) {
							console.error(execData.stderr);
						}
					} else if (subcommand === "read" && result.data) {
						const readData = result.data as { output: string };
						console.log(readData.output);
					} else if (subcommand === "list" && result.data) {
						const sessions = result.data as Array<{
							id: string;
							name?: string;
							shell: string;
							cwd: string;
							status: string;
							resumeMetadata?: {
								restored?: boolean;
								resumeLevel?: number;
								status?: string;
							};
						}>;
						for (const s of sessions) {
							const resumeTag = s.resumeMetadata?.restored
								? ` [${s.resumeMetadata.status ?? "resumed"} L${s.resumeMetadata.resumeLevel ?? 1}]`
								: "";
							console.log(
								`  ${s.id}  ${s.shell}  ${s.cwd}  ${s.status}${resumeTag}`,
							);
						}
						console.log(`\n${sessions.length} session(s)`);
					} else if (
						(subcommand === "resume" || subcommand === "status") &&
						result.data
					) {
						const resumeData = result.data as {
							sessionId: string;
							status: string;
							resumeLevel: number;
							preserved: { metadata: boolean; buffer: boolean };
							lost: string[];
						};
						console.log(`Session: ${resumeData.sessionId}`);
						console.log(`Status:  ${resumeData.status}`);
						console.log(`Level:   ${resumeData.resumeLevel}`);
						console.log(
							`Preserved: metadata=${resumeData.preserved.metadata}, buffer=${resumeData.preserved.buffer}`,
						);
						if (resumeData.lost.length > 0) {
							console.log(`Lost:    ${resumeData.lost.join(", ")}`);
						}
					} else if (subcommand === "view" && result.data) {
						const { buildTerminalView } = await import("./terminal/render");
						const view = buildTerminalView(
							result.data as import("./terminal/types").TerminalSnapshot,
						);
						if (flags.dashboard === "true" || flags.json === "true") {
							outputJson(view, true);
						} else {
							console.log(
								`Browser Terminal View: ${view.title} (${view.status})`,
							);
							console.log(`Can accept input: ${view.canAcceptInput}`);
							console.log(`Rows:`);
							for (const row of view.rows) {
								console.log(
									`  [${row.index.toString().padStart(4)}] ${row.text}`,
								);
							}
						}
					} else {
						outputJson(result.data, true);
					}
					if (result.warning) console.warn(`Warning: ${result.warning}`);
				} else {
					console.error(`Error: ${result.error}`);
					if (result.policyDecision)
						console.error(`Policy: ${result.policyDecision}`);
					process.exit(1);
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

// ── FS Handlers (Section 5 — routed through action surface) ──────────

export async function handleFs(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const confirmed = flags.yes === "true" || flags.confirm === "true";

	const { SessionManager } = await import("./session_manager");
	const { FsActions } = await import("./filesystem/actions");
	const { formatActionResult } = await import("./shared/action_result");

	// Use or create a session manager singleton (same as browser/term actions)
	if (!_sessionManager) {
		_sessionManager = new SessionManager();
	}

	const fsActions = new FsActions({ sessionManager: _sessionManager });

	try {
		let result: import("./shared/action_result").ActionResult | undefined;

		switch (subcommand) {
			case "read": {
				const filePath = positional[0];
				if (!filePath) {
					console.error("Error: File path is required");
					process.exit(1);
				}
				result = await fsActions.read({
					path: filePath,
					maxBytes: flags["max-bytes"] ? Number(flags["max-bytes"]) : undefined,
				});
				break;
			}

			case "write": {
				const filePath = positional[0];
				if (!filePath) {
					console.error("Error: File path is required");
					process.exit(1);
				}
				result = await fsActions.write({
					path: filePath,
					content: flags.content ?? "",
					createDirs: flags["create-dirs"] !== "false",
					confirmed,
				});
				break;
			}

			case "ls": {
				const dirPath = positional[0] ?? ".";
				result = await fsActions.ls({
					path: dirPath,
					recursive: flags.recursive === "true",
					extension: flags.ext,
				});
				break;
			}

			case "move": {
				const src = positional[0];
				const dst = positional[1];
				if (!src || !dst) {
					console.error("Error: Source and destination paths are required");
					process.exit(1);
				}
				result = await fsActions.move({ src, dst, confirmed });
				break;
			}

			case "rm": {
				const targetPath = positional[0];
				if (!targetPath) {
					console.error("Error: Path is required");
					process.exit(1);
				}
				result = await fsActions.rm({
					path: targetPath,
					recursive: flags.recursive === "true",
					force: flags.force === "true",
					confirmed,
				});
				break;
			}

			case "stat": {
				const targetPath = positional[0];
				if (!targetPath) {
					console.error("Error: Path is required");
					process.exit(1);
				}
				result = await fsActions.stat({ path: targetPath });
				break;
			}

			default:
				console.error(`Unknown fs command: ${subcommand}`);
				process.exit(1);
		}

		if (result) {
			if (jsonOutput) {
				outputJson(formatActionResult(result), false);
			} else {
				if (result.success) {
					// Human-friendly output per action type
					if (subcommand === "read" && result.data) {
						const readData =
							result.data as import("./filesystem/operations").FileReadResult;
						console.log(readData.content);
					} else if (subcommand === "ls" && result.data) {
						const listData =
							result.data as import("./filesystem/operations").ListResult;
						for (const entry of listData.entries) {
							const typeChar =
								entry.type === "directory"
									? "d"
									: entry.type === "symlink"
										? "l"
										: "-";
							const size = entry.sizeBytes.toString().padStart(10);
							console.log(`${typeChar} ${size}  ${entry.name}`);
						}
						console.log(`\n${listData.totalEntries} entries`);
					} else {
						outputJson(result.data, true);
					}
					if (result.warning) console.warn(`Warning: ${result.warning}`);
				} else {
					console.error(`Error: ${result.error}`);
					if (result.policyDecision)
						console.error(`Policy: ${result.policyDecision}`);
					process.exit(1);
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

// ── Dashboard Handler (Section 28) ──────────────────────────────────

async function handleDashboard(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";

	switch (subcommand) {
		case "status": {
			try {
				const { getDashboardState } = await import("./operator/dashboard");
				const state = await getDashboardState();
				outputJson(state, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}
		case "open": {
			try {
				const { createWebAppServer, openUrlInDefaultBrowser } = await import(
					"./web/server"
				);
				const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
				const port = typeof flags.port === "string" ? Number(flags.port) : 7790;
				const token = typeof flags.token === "string" ? flags.token : undefined;
				const server = createWebAppServer({
					host,
					port,
					token,
					allowRemote: flags["allow-remote"] === "true",
				});
				const info = await server.listen();
				const url = `${info.url}/#token=${info.token}`;
				if (jsonOutput) {
					outputJson({ success: true, ...info, openUrl: url }, false);
					if (flags.wait !== "true") {
						await server.close();
						return;
					}
				} else {
					console.log(`Dashboard: ${url}`);
					openUrlInDefaultBrowser(url);
					console.log("Press Ctrl+C to stop.");
				}
				if (flags.wait === "true") {
					await new Promise<void>(() => undefined);
				}
			} catch (error: unknown) {
				console.error("Error:", errorMessage(error));
				process.exit(1);
			}
			break;
		}
		default:
			console.error(`Unknown dashboard command: ${subcommand}`);
			console.error("Available: status, open");
			process.exit(1);
	}
}

async function handleWeb(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "serve";

	switch (action) {
		case "serve":
		case "open": {
			try {
				const { createWebAppServer, openUrlInDefaultBrowser } = await import(
					"./web/server"
				);
				const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
				const port = typeof flags.port === "string" ? Number(flags.port) : 7790;
				const token = typeof flags.token === "string" ? flags.token : undefined;
				const server = createWebAppServer({
					host,
					port,
					token,
					allowRemote: flags["allow-remote"] === "true",
				});
				const info = await server.listen();
				const openUrl = `${info.url}/#token=${info.token}`;
				if (jsonOutput) {
					outputJson({ success: true, ...info, openUrl }, false);
					// serve is a foreground server command — keep running even with --json.
					// open may print JSON and return unless --wait is explicitly set.
					if (action === "open" && flags.wait !== "true") {
						await server.close();
						return;
					}
				} else {
					console.log(`Browser Control web app: ${openUrl}`);
					if (action === "open") openUrlInDefaultBrowser(openUrl);
					console.log("Press Ctrl+C to stop.");
				}
				// Block forever — the server stays alive until killed.
				await new Promise<void>(() => undefined);
				break;
			} catch (error: unknown) {
				console.error("Error:", errorMessage(error));
				process.exit(1);
			}
			break;
		}
		default:
			console.error(`Unknown web command: ${action}`);
			console.error("Available: serve, open");
			process.exit(1);
	}
}

async function handleData(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "doctor";
	const { cleanupDataHome, exportDataHome, formatDataHomeReport, inspectDataHome } =
		await import("./data_home");

	switch (action) {
		case "doctor": {
			const report = inspectDataHome();
			if (jsonOutput) outputJson(report, false);
			else console.log(formatDataHomeReport(report));
			return;
		}
		case "cleanup": {
			const dryRunRequested = flags["dry-run"] === "false";
			const confirm = flags.confirm;
			const dryRun = !dryRunRequested || confirm !== "DELETE_RUNTIME_TEMP";

			if (dryRunRequested && confirm !== "DELETE_RUNTIME_TEMP") {
				console.error(
					"Error: Destructive cleanup requires explicit confirmation.",
				);
				console.error(
					"Use: data cleanup --dry-run=false --confirm=DELETE_RUNTIME_TEMP",
				);
				process.exit(1);
			}

			const result = cleanupDataHome(undefined, { dryRun, confirm });
			if (jsonOutput) outputJson(result, false);
			else {
				console.log(
					`${result.dryRun ? "Dry run" : "Cleanup"}: ${result.candidates.length} candidates, ${result.reclaimedBytes} bytes reclaimed.`,
				);
				if (result.dryRun && dryRunRequested) {
					console.log(
						"Note: This was a dry run because confirmation was invalid or missing.",
					);
				}
			}
			return;
		}
		case "export": {
			const result = exportDataHome(undefined, {
				label: typeof flags.label === "string" ? flags.label : "cli",
			});
			if (jsonOutput) outputJson(result, false);
			else console.log(`Export written: ${result.exportDir}`);
			return;
		}
		default:
			console.error(`Unknown data command: ${action}`);
			console.error("Available: doctor, cleanup, export");
			process.exit(1);
	}
}

async function handleBenchmark(args: ParsedArgs): Promise<void> {
	const { subcommand, flags, positional } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "run";
	const {
		compareBenchmarkRuns,
		listBenchmarkRuns,
		runBenchmarks,
	} = await import("./benchmarks/runner");

	switch (action) {
		case "run": {
			const result = await runBenchmarks({
				suite: (flags.suite || "all") as never,
				iterations: flags.iterations ? Number(flags.iterations) : 1,
			});
			if (jsonOutput) outputJson(result, false);
			else {
				console.log(
					`Benchmark ${result.runId}: ${result.summary.passed}/${result.summary.totalBenchmarks} passed, ${Math.round(
						result.summary.avgDurationMs,
					)} ms avg.`,
				);
				console.log(`Saved: ${result.savedPath}`);
			}
			return;
		}
		case "results": {
			const result = listBenchmarkRuns(undefined, {
				last: flags.last ? Number(flags.last) : 10,
			});
			if (jsonOutput) outputJson(result, false);
			else {
				for (const run of result) {
					console.log(
						`${run.runId} ${run.suite} ${run.summary.passed}/${run.summary.totalBenchmarks} ${Math.round(
							run.summary.avgDurationMs,
						)} ms avg`,
					);
				}
			}
			return;
		}
		case "compare": {
			const [baseRunId, compareRunId] = positional;
			if (!baseRunId || !compareRunId) {
				throw new Error("benchmark compare requires <baseRunId> <compareRunId>.");
			}
			const result = compareBenchmarkRuns(
				(await import("./shared/paths")).getDataHome(),
				baseRunId,
				compareRunId,
			);
			if (jsonOutput) outputJson(result, false);
			else {
				console.log(
					`Success delta: ${result.successRateDelta}; avg duration delta: ${Math.round(
						result.avgDurationDeltaMs,
					)} ms`,
				);
			}
			return;
		}
		default:
			console.error(`Unknown benchmark command: ${action}`);
			console.error("Available: run, results, compare");
			process.exit(1);
	}
}

// ── Desktop Wrapper Handler ─────────────────────────────────────────────

async function handleDesktop(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "start";

	if (action === "start") {
		try {
			const { spawn } = await import("node:child_process");
			const pathMod = await import("node:path");
			const fsMod = await import("node:fs");
			const { createRequire } = await import("node:module");

			const desktopMain = pathMod.resolve(
				__dirname,
				"..",
				"desktop",
				"main.cjs",
			);
			if (!fsMod.existsSync(desktopMain)) {
				throw new Error(
					`Desktop wrapper not found at ${desktopMain}. Is the desktop package present?`,
				);
			}

			// Prefer the real Windows executable; detached spawning electron.cmd can
			// fail with EINVAL on Node/Windows.
			let electronBin: string;
			const windowsElectronExe = pathMod.resolve(
				__dirname,
				"..",
				"node_modules",
				"electron",
				"dist",
				"electron.exe",
			);
			const localElectron = pathMod.resolve(
				__dirname,
				"..",
				"node_modules",
				".bin",
				process.platform === "win32" ? "electron.cmd" : "electron",
			);
			const requireFromRoot = createRequire(
				pathMod.resolve(__dirname, "..", "package.json"),
			);
			let resolvedElectronExe = "";
			try {
				const electronPackagePath = requireFromRoot.resolve(
					"electron/package.json",
				);
				resolvedElectronExe = pathMod.join(
					pathMod.dirname(electronPackagePath),
					"dist",
					process.platform === "win32" ? "electron.exe" : "electron",
				);
			} catch {
				resolvedElectronExe = "";
			}
			if (
				process.platform === "win32" &&
				fsMod.existsSync(windowsElectronExe)
			) {
				electronBin = windowsElectronExe;
			} else if (resolvedElectronExe && fsMod.existsSync(resolvedElectronExe)) {
				electronBin = resolvedElectronExe;
			} else if (fsMod.existsSync(localElectron)) {
				electronBin = localElectron;
			} else {
				electronBin = "electron"; // Fall back to PATH
			}

			const child = spawn(electronBin, [desktopMain], {
				stdio: "ignore",
				detached: true,
				env: { ...process.env, BROWSER_CONTROL_NODE: process.execPath },
				windowsHide: true,
			});
			child.unref();

			if (jsonOutput) {
				outputJson(
					{ success: true, pid: child.pid, message: "Started desktop wrapper" },
					false,
				);
			} else {
				console.log(`Started Browser Control Desktop (pid ${child.pid}).`);
			}
		} catch (error: unknown) {
			const message = errorMessage(error);
			if (jsonOutput) {
				outputJson({ success: false, error: message }, false);
			} else {
				console.error("Error:", message);
			}
			process.exit(1);
		}
	} else {
		console.error(`Unknown desktop command: ${action}`);
		console.error("Available: start");
		process.exit(1);
	}
}

// ── Workflow & Harness Action Handlers (Section 29) ─────────────────────

async function handleWorkflow(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { createBrowserControl } = await import("./browser_control");
	const bc = createBrowserControl();

	try {
		switch (subcommand) {
			case "run": {
				const graphPathOrName = positional[0];
				if (!graphPathOrName) {
					console.error("Error: graphPathOrName is required");
					process.exit(1);
				}
				let graphJson = "";
				try {
					const fs = await import("node:fs");
					const path = await import("node:path");
					const target = path.resolve(graphPathOrName);
					if (fs.existsSync(target)) {
						graphJson = fs.readFileSync(target, "utf8");
					} else {
						graphJson = graphPathOrName;
					}
					// Validate JSON syntax before passing
					JSON.parse(graphJson);
				} catch {
					console.error(
						"Error: graphPathOrName must be a valid JSON string or path to a JSON file",
					);
					process.exit(1);
				}
				const result = await bc.workflow.run(graphJson);
				outputJson(result, !jsonOutput);
				break;
			}
			case "status": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					process.exit(1);
				}
				const result = await bc.workflow.status(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "resume": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					process.exit(1);
				}
				const result = await bc.workflow.resume(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "approve": {
				const runId = positional[0];
				const nodeId = positional[1];
				if (!runId || !nodeId) {
					console.error("Error: runId and nodeId are required");
					process.exit(1);
				}
				const result = await bc.workflow.approve(runId, nodeId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "cancel": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					process.exit(1);
				}
				const result = await bc.workflow.cancel(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown workflow command: ${subcommand}`);
				console.error("Available: run, status, resume, approve, cancel");
				process.exit(1);
		}
	} finally {
		bc.close();
	}
}

async function handleHarness(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { createBrowserControl } = await import("./browser_control");
	const bc = createBrowserControl();

	try {
		switch (subcommand) {
			case "list": {
				const result = await bc.harness.list();
				outputJson(result, !jsonOutput);
				break;
			}
			case "validate": {
				const helperId = positional[0];
				if (!helperId) {
					console.error("Error: helperId is required");
					process.exit(1);
				}
				const result = await bc.harness.validate(helperId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "rollback": {
				const helperId = positional[0];
				const version = positional[1];
				if (!helperId || !version) {
					console.error("Error: helperId and version are required");
					process.exit(1);
				}
				const result = await bc.harness.rollback(helperId, version);
				outputJson(result, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown harness command: ${subcommand}`);
				console.error("Available: list, validate, rollback");
				process.exit(1);
		}
	} finally {
		bc.close();
	}
}

async function handlePackage(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { createBrowserControl } = await import("./browser_control");
	const bc = createBrowserControl();

	try {
		switch (subcommand) {
			case "install": {
				const source = positional[0];
				if (!source) {
					console.error("Error: package source path is required");
					process.exit(1);
				}
				const result = await bc.package.install(source);
				outputJson(result, !jsonOutput);
				break;
			}
			case "list": {
				const result = await bc.package.list();
				outputJson(result, !jsonOutput);
				break;
			}
			case "info": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					process.exit(1);
				}
				const result = await bc.package.info(name);
				outputJson(result, !jsonOutput);
				break;
			}
			case "remove": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					process.exit(1);
				}
				const result = await bc.package.remove(name);
				outputJson(result, !jsonOutput);
				break;
			}
			case "update": {
				const name = positional[0];
				const source = positional[1];
				if (!name) {
					console.error("Error: package name is required");
					process.exit(1);
				}
				const result = await bc.package.update(name, source);
				outputJson(result, !jsonOutput);
				break;
			}
			case "grant": {
				const name = positional[0];
				const permissionRef = positional[1];
				if (!name || !permissionRef) {
					console.error(
						"Error: package name and permission kind or index are required",
					);
					process.exit(1);
				}
				const ref = /^\d+$/.test(permissionRef)
					? Number(permissionRef)
					: permissionRef;
				const result = bc.package.grantPermission(name, ref);
				outputJson(result, !jsonOutput);
				break;
			}
			case "run": {
				const name = positional[0];
				const workflowNameOrId = positional[1];
				if (!name || !workflowNameOrId) {
					console.error("Error: package name and workflow are required");
					process.exit(1);
				}
				const result = await bc.package.run(name, workflowNameOrId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "eval": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					process.exit(1);
				}
				const result = await bc.package.eval(name);
				outputJson(result, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown package command: ${subcommand}`);
				console.error(
					"Available: install, list, info, remove, update, grant, run, eval",
				);
				process.exit(1);
		}
	} finally {
		bc.close();
	}
}

// ── Top-level Browser Action Handler (Section 5) ────────────────────

async function handleBrowserAction(
	action: string,
	args: ParsedArgs,
): Promise<void> {
	const { flags } = args;
	const positional = getBrowserActionPositionals(action, args);
	const jsonOutput = flags.json === "true";

	const { SessionManager } = await import("./session_manager");
	const { BrowserActions } = await import("./browser/actions");
	const { formatActionResult } = await import("./shared/action_result");

	// Use or create a session manager singleton
	if (!_sessionManager) {
		_sessionManager = new SessionManager();
	}

	const browserActions = new BrowserActions({
		sessionManager: _sessionManager,
	});

	try {
		let result: import("./shared/action_result").ActionResult | undefined;

		switch (action) {
			case "open": {
				const url = positional[0];
				if (!url) {
					console.error("Error: URL is required");
					process.exit(1);
				}
				result = await browserActions.open({
					url,
					waitUntil: parseWaitUntil(flags["wait-until"]),
				});
				break;
			}

			case "snapshot": {
				result = await browserActions.takeSnapshot({
					rootSelector: flags["root-selector"],
					boxes: flags.boxes === "true",
				});
				break;
			}

			case "click": {
				const target = positional[0];
				if (!target) {
					console.error("Error: Target (ref, selector, or text) is required");
					process.exit(1);
				}
				result = await browserActions.click({
					target,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					force: flags.force === "true",
				});
				break;
			}

			case "fill": {
				const target = positional[0];
				const text = positional[1];
				if (!target || !text) {
					console.error("Error: Target and text are required");
					process.exit(1);
				}
				result = await browserActions.fill({
					target,
					text,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					commit: flags.commit === "true",
				});
				break;
			}

			case "hover": {
				const target = positional[0];
				if (!target) {
					console.error("Error: Target is required");
					process.exit(1);
				}
				result = await browserActions.hover({
					target,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
				});
				break;
			}

			case "type": {
				const text = positional[0];
				if (!text) {
					console.error("Error: Text is required");
					process.exit(1);
				}
				result = await browserActions.type({
					text,
					delayMs: flags.delay ? Number(flags.delay) : undefined,
				});
				break;
			}

			case "press": {
				const key = positional[0];
				if (!key) {
					console.error("Error: Key is required (e.g., Enter, Tab, ArrowDown)");
					process.exit(1);
				}
				result = await browserActions.press({ key });
				break;
			}

			case "scroll": {
				const direction = positional[0] ?? "down";
				if (!["up", "down", "left", "right"].includes(direction)) {
					console.error("Error: Direction must be up, down, left, or right");
					process.exit(1);
				}
				result = await browserActions.scroll({
					direction: direction as "up" | "down" | "left" | "right",
					amount: flags.amount ? Number(flags.amount) : undefined,
				});
				break;
			}

			case "screenshot": {
				const refs = flags.refs
					? (flags.refs as string).split(",").map((r) => r.trim())
					: undefined;
				result = await browserActions.screenshot({
					outputPath: flags.output,
					fullPage: flags["full-page"] === "true",
					target: flags.target,
					annotate: flags.annotate === "true",
					refs,
				});
				break;
			}

			case "tab": {
				const tabAction = args.subcommand;
				if (tabAction === "list") {
					result = await browserActions.tabList();
				} else if (tabAction === "switch") {
					const tabId = positional[0];
					if (!tabId) {
						console.error("Error: Tab ID is required");
						process.exit(1);
					}
					result = await browserActions.tabSwitch(tabId);
				} else {
					console.error(
						"Error: Unknown tab command. Use 'tab list' or 'tab switch <id>'",
					);
					process.exit(1);
				}
				break;
			}

			case "close": {
				result = await browserActions.close();
				break;
			}

			case "screencast": {
				const screencastAction = args.subcommand;
				if (screencastAction === "start") {
					const options: ScreencastOptions = {};
					if (flags.path) options.path = flags.path as string;
					if (flags["show-actions"] === "true") options.showActions = true;
					options.annotationPosition = parseAnnotationPosition(
						flags["annotation-position"],
					);
					options.retention = parseScreencastRetention(flags.retention);
					result = await browserActions.screencastStart(options);
				} else if (screencastAction === "stop") {
					result = await browserActions.screencastStop();
				} else if (screencastAction === "status") {
					result = await browserActions.screencastStatus();
				} else {
					console.error(
						"Error: Unknown screencast command. Use 'screencast start', 'screencast stop', or 'screencast status'",
					);
					process.exit(1);
				}
				break;
			}

			default:
				console.error(`Unknown browser action: ${action}`);
				process.exit(1);
		}

		if (result) {
			if (jsonOutput) {
				outputJson(formatActionResult(result), false);
			} else {
				if (result.success) {
					// Human-friendly output
					if (result.data) outputJson(result.data, true);
					else console.log("OK");
					if (result.warning) console.warn(`Warning: ${result.warning}`);
				} else {
					console.error(`Error: ${result.error}`);
					if (result.policyDecision)
						console.error(`Policy: ${result.policyDecision}`);
					process.exit(1);
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

// ── Locator Handler (Section 25) ────────────────────────────────────────

async function handleLocator(args: ParsedArgs): Promise<void> {
	const { positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const target = positional[0];
	if (!target) {
		console.error("Error: Target (ref, selector, or text) is required");
		process.exit(1);
	}

	const { createBrowserControl } = await import("./browser_control");
	const { formatActionResult } = await import("./shared/action_result");

	try {
		const bc = createBrowserControl();
		const result = await bc.browser.generateLocator(target);

		if (jsonOutput) {
			outputJson(formatActionResult(result), false);
		} else {
			if (result.success) {
				console.log(`Locator candidates for: ${target}`);
				const candidates: LocatorCandidate[] | undefined =
					result.data?.candidates;
				if (candidates) {
					for (const candidate of candidates) {
						console.log(
							`  [${candidate.confidence}] ${candidate.kind}: ${candidate.value}`,
						);
						console.log(`    Reason: ${candidate.reason}`);
					}
				}
				if (result.warning) console.warn(`Warning: ${result.warning}`);
			} else {
				console.error(`Error: ${result.error}`);
				if (result.policyDecision)
					console.error(`Policy: ${result.policyDecision}`);
				process.exit(1);
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

// ── Session Handler (Section 5) ────────────────────────────────────────

async function handleSession(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const { SessionManager } = await import("./session_manager");
	const { formatActionResult } = await import("./shared/action_result");

	if (!_sessionManager) {
		_sessionManager = new SessionManager();
	}

	try {
		let result: import("./shared/action_result").ActionResult | undefined;

		switch (subcommand) {
			case "list": {
				result = _sessionManager.list();
				break;
			}

			case "create": {
				const name = positional[0];
				if (!name) {
					console.error("Error: Session name is required");
					process.exit(1);
				}
				result = await _sessionManager.create(name, {
					policyProfile: flags.policy,
					workingDirectory: flags.cwd,
				});
				break;
			}

			case "use": {
				const nameOrId = positional[0];
				if (!nameOrId) {
					console.error("Error: Session name or ID is required");
					process.exit(1);
				}
				result = _sessionManager.use(nameOrId);
				break;
			}

			case "status": {
				result = _sessionManager.status();
				break;
			}

			default:
				console.error(`Unknown session command: ${subcommand}`);
				console.error("Available: list, create, use, status");
				process.exit(1);
		}

		if (result) {
			if (jsonOutput) {
				outputJson(formatActionResult(result), false);
			} else {
				if (result.success) {
					outputJson(result.data, true);
					if (result.warning) console.warn(`Warning: ${result.warning}`);
				} else {
					console.error(`Error: ${result.error}`);
					process.exit(1);
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

// ── Service Handler (Section 14) ─────────────────────────────────────

async function handleService(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const { SessionManager } = await import("./session_manager");
	const { ServiceActions } = await import("./service_actions");
	const { formatActionResult } = await import("./shared/action_result");

	if (!_sessionManager) {
		_sessionManager = new SessionManager();
	}

	const serviceActions = new ServiceActions({
		sessionManager: _sessionManager,
	});

	try {
		let result: import("./shared/action_result").ActionResult | undefined;

		switch (subcommand) {
			case "register": {
				const name = positional[0];
				if (!name) {
					console.error("Error: Service name is required");
					process.exit(1);
				}
				const rawPort = flags.port ? Number(flags.port) : undefined;
				const detect = flags.detect === "true";
				const cwd = flags.cwd;

				let port = rawPort;

				if (detect && cwd) {
					const { detectDevServer } = await import("./services/detector");
					const detected = detectDevServer(cwd);
					if (detected) {
						port = detected.port;
					}
				}

				if (port === undefined || Number.isNaN(port)) {
					console.error(
						"Error: --port is required when detection is not used or detection fails",
					);
					process.exit(1);
				}

				result = await serviceActions.register({
					name,
					port,
					protocol: flags.protocol as "http" | "https" | undefined,
					path: flags.path,
					detect,
					cwd,
				});
				break;
			}

			case "list": {
				result = serviceActions.list();
				break;
			}

			case "resolve": {
				const name = positional[0];
				if (!name) {
					console.error("Error: Service name is required");
					process.exit(1);
				}
				result = await serviceActions.resolve({ name });
				break;
			}

			case "remove": {
				const name = positional[0];
				if (!name) {
					console.error("Error: Service name is required");
					process.exit(1);
				}
				result = serviceActions.remove({ name });
				break;
			}

			default:
				console.error(`Unknown service command: ${subcommand}`);
				console.error("Available: register, list, resolve, remove");
				process.exit(1);
		}

		if (result) {
			if (jsonOutput) {
				outputJson(formatActionResult(result), false);
			} else {
				if (result.success) {
					if (result.data) outputJson(result.data, true);
					else console.log("OK");
					if (result.warning) console.warn(`Warning: ${result.warning}`);
				} else {
					console.error(`Error: ${result.error}`);
					process.exit(1);
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		process.exit(1);
	}
}

function mergeObservabilityEntries<T extends { timestamp: string }>(
	...groups: T[][]
): T[] {
	const seen = new Set<string>();
	const entries: T[] = [];
	for (const entry of groups.flat()) {
		const key = JSON.stringify(entry);
		if (seen.has(key)) continue;
		seen.add(key);
		entries.push(entry);
	}
	return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function handleDebug(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";

	switch (subcommand) {
		case "bundle": {
			const bundleId = positional[0];
			if (!bundleId) {
				console.error("Error: Bundle ID is required");
				process.exit(1);
			}
			const confirmed = flags.yes === "true" || flags.confirm === "true";
			await requireCliPolicy(
				"debug_bundle_export",
				{ bundleId, output: flags.output },
				jsonOutput,
				confirmed,
			);

			try {
				const { loadDebugBundle } = await import(
					"./observability/debug_bundle"
				);
				const { MemoryStore } = await import("./runtime/memory_store");
				const store = new MemoryStore();
				const bundle = loadDebugBundle(bundleId, store);
				store.close();

				if (!bundle) {
					console.error(`Error: Bundle "${bundleId}" not found`);
					process.exit(1);
				}

				if (flags.output) {
					const fs = await import("node:fs");
					fs.writeFileSync(flags.output, JSON.stringify(bundle, null, 2));
					console.log(`Bundle saved to: ${flags.output}`);
				} else {
					outputJson(bundle, !jsonOutput);
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "console": {
			try {
				const { getGlobalConsoleCapture } = await import(
					"./observability/console_capture"
				);
				const { MemoryStore } = await import("./runtime/memory_store");
				const capture = getGlobalConsoleCapture();
				const sessionId = flags.session ?? "default";
				await requireCliPolicy("debug_console_read", { sessionId }, jsonOutput);
				const store = new MemoryStore();
				const entries = (() => {
					try {
						return mergeObservabilityEntries(
							capture.loadFromStore(store, sessionId),
							capture.getEntries(sessionId),
						);
					} finally {
						store.close();
					}
				})();

				if (jsonOutput) {
					outputJson({ sessionId, entries }, false);
				} else {
					console.log(
						`Console entries for session: ${sessionId} (${entries.length} total)`,
					);
					for (const entry of entries.slice(-20)) {
						const time = new Date(entry.timestamp).toLocaleTimeString();
						console.log(
							`  [${time}] ${entry.level.toUpperCase()}: ${entry.message.slice(0, 200)}`,
						);
					}
					if (entries.length > 20) {
						console.log(`  ... and ${entries.length - 20} more`);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "network": {
			try {
				const { getGlobalNetworkCapture } = await import(
					"./observability/network_capture"
				);
				const { MemoryStore } = await import("./runtime/memory_store");
				const capture = getGlobalNetworkCapture();
				const sessionId = flags.session ?? "default";
				await requireCliPolicy("debug_network_read", { sessionId }, jsonOutput);
				const store = new MemoryStore();
				const entries = (() => {
					try {
						return mergeObservabilityEntries(
							capture.loadFromStore(store, sessionId),
							capture.getEntries(sessionId),
						);
					} finally {
						store.close();
					}
				})();

				if (jsonOutput) {
					outputJson({ sessionId, entries }, false);
				} else {
					console.log(
						`Network entries for session: ${sessionId} (${entries.length} total)`,
					);
					for (const entry of entries.slice(-20)) {
						const time = new Date(entry.timestamp).toLocaleTimeString();
						const statusStr = entry.status ? ` [${entry.status}]` : "";
						const errorStr = entry.error ? ` ERROR: ${entry.error}` : "";
						console.log(
							`  [${time}] ${entry.method} ${entry.url.slice(0, 80)}${statusStr}${errorStr}`,
						);
					}
					if (entries.length > 20) {
						console.log(`  ... and ${entries.length - 20} more`);
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		case "receipt": {
			const receiptId = positional[0];
			if (!receiptId) {
				console.error("Error: Receipt ID is required");
				process.exit(1);
			}
			await requireCliPolicy("debug_receipt_export", { receiptId }, jsonOutput);
			try {
				const { getGlobalScreencastRecorder } = await import(
					"./observability/screencast"
				);
				const { MemoryStore } = await import("./runtime/memory_store");
				const store = new MemoryStore();
				let receipt: import("./observability/types").DebugReceipt | null;
				try {
					const recorder = getGlobalScreencastRecorder(store);
					receipt = recorder.loadReceipt(receiptId);
				} finally {
					store.close();
				}
				if (!receipt) {
					console.error(`Error: Receipt not found: ${receiptId}`);
					process.exit(1);
				}
				outputJson(receipt, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				process.exit(1);
			}
			break;
		}

		default:
			console.error(`Unknown debug command: ${subcommand}`);
			console.error(
				"Available: bundle <id>, console [--session=<id>], network [--session=<id>], receipt <id>",
			);
			process.exit(1);
	}
}

if (require.main === module) {
	runCli().catch((error) => {
		console.error("Fatal error:", error.message);
		process.exit(1);
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
