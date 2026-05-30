#!/usr/bin/env ts-node

import fs from "node:fs";
import path from "node:path";
import type { LocatorCandidate, OpenOptions } from "./browser/actions";
import type { BrowserTargetType } from "./browser/connection";
import type { KnowledgeKind, ValidationResult } from "./knowledge/types";
import type { ScreencastOptions } from "./observability/types";
import type { ProviderConfig } from "./providers/types";
import { installGlobalFatalHandlers } from "./shared/fatal_handlers";

// DEFAULT_PORT kept for help text; actual port comes from loadConfig()

interface CliErrorOptions {
	exitCode?: number;
	cleanupRequired?: boolean;
	command?: string;
	hint?: string;
	reported?: boolean;
}

let cliErrorContext: string | undefined;

function rememberCliErrorContext(args: unknown[]): void {
	const text = args
		.map((arg) => (arg instanceof Error ? arg.message : String(arg)))
		.join(" ")
		.trim();
	if (!text) return;
	const normalized = text.replace(/^Error:\s*/i, "").trim();
	if (!normalized) return;
	if (/^(Available:|Use:|Rerun with|Log:)/i.test(normalized)) return;
	if (/^\s+-\s+/.test(normalized)) return;
	if (
		text.startsWith("Error:") ||
		text.startsWith("Unknown ") ||
		/failed/i.test(normalized) ||
		cliErrorContext === undefined
	) {
		cliErrorContext = normalized;
	}
}

function commandFailed(options?: CliErrorOptions): CliError {
	const message = cliErrorContext ?? "Command failed";
	const reported = cliErrorContext !== undefined;
	cliErrorContext = undefined;
	return new CliError(message, { ...options, reported: options?.reported ?? reported });
}

export class CliError extends Error {
	override name = "CliError" as const;
	exitCode: number;
	cleanupRequired: boolean;
	command?: string;
	hint?: string;
	reported: boolean;

	constructor(
		message: string,
		options?: CliErrorOptions,
	) {
		super(message);
		this.exitCode = options?.exitCode ?? 1;
		this.cleanupRequired = options?.cleanupRequired ?? true;
		this.command = options?.command;
		this.hint = options?.hint;
		this.reported = options?.reported ?? false;
	}
}

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
	"activate",
	"amount",
	"api-key",
	"browser-mode",
	"browserless-api-key",
	"browserless-endpoint",
	"ca-dir",
	"cdp-url",
	"cert",
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
	"days",
	"debug-endpoint",
	"delay",
	"domains",
	"endpoint",
	"ext",
	"failure-types",
	"file",
	"files",
	"fields",
	"format",
	"health-check-interval",
	"help",
	"host",
	"id",
	"input",
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
	"output-path",
	"outputPath",
	"params",
	"path",
	"pattern",
	"policy",
	"port",
	"priority",
	"profile",
	"protocol",
	"provider",
	"purpose",
	"query",
	"region",
	"retention",
	"resource-types",
	"root-selector",
	"rule-type",
	"screenshot-path",
	"session",
	"shell",
	"show-actions",
	"skill",
	"scope",
	"scope-name",
	"secret-id",
	"secret-name",
	"site",
	"status-file",
	"style",
	"suite",
	"tab",
	"tab-id",
	"tabId",
	"target",
	"target-type",
	"task-tags",
	"terminal-shell",
	"test-command",
	"token",
	"timeout",
	"timeoutMs",
	"type",
	"url",
	"usage",
	"value",
	"version",
	"wait-until",
	"annotation-position",
	"continue-on-failure",
	"continueOnFailure",
	"steps",
	"snapshot",
	"screenshot",
	"downloads",
	"dialog",
	"boxes",
	"root-selector",
	"url",
	"urls",
	"fields",
	"wait-until",
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

function exitImmediately(code: number): never {
	const reallyExit = (
		process as NodeJS.Process & { reallyExit?: (exitCode?: number) => never }
	).reallyExit;
	if (typeof reallyExit === "function") {
		reallyExit.call(process, code);
	}
	process.exit(code);
}

async function closeFetchDispatcher(): Promise<void> {
	try {
		const undici = await import("undici");
		const dispatcher = undici.getGlobalDispatcher();
		await dispatcher.close();
	} catch {
		// Best-effort: only used to let short-lived CLI processes exit cleanly.
	}
}

function cliTimeoutResult(label: string, timeoutMs: number): {
	success: false;
	path: "cli";
	error: string;
	completedAt: string;
} {
	return {
		success: false,
		path: "cli",
		error: `${label} timed out after ${timeoutMs}ms`,
		completedAt: new Date().toISOString(),
	};
}

async function withCliTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<{ result: T | ReturnType<typeof cliTimeoutResult>; timedOut: boolean }> {
	let timedOut = false;
	let timerHandle: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<ReturnType<typeof cliTimeoutResult>>((resolve) => {
		timerHandle = setTimeout(() => {
			timedOut = true;
			resolve(cliTimeoutResult(label, timeoutMs));
		}, timeoutMs);
	});
	const result = await Promise.race([promise, timeout]);
	if (!timedOut && timerHandle) {
		clearTimeout(timerHandle);
	}
	return { result, timedOut };
}

async function finishTimedCliResult(
	timedOut: boolean,
	message = "Command timed out",
): Promise<void> {
	await closeFetchDispatcher();
	if (timedOut) {
		throw new CliError(message, { exitCode: 1 });
	}
}

async function cleanupBrowserSession(
	bc: { close: () => void; sessionManager?: { releaseCliHandles: () => Promise<void> } },
	timedOut: boolean,
): Promise<void> {
	try { await bc.sessionManager?.releaseCliHandles(); } catch { /* best-effort */ }
	try { bc.close(); } catch { /* best-effort */ }
	await closeFetchDispatcher();
	if (timedOut) {
		const exitTimer = setTimeout(() => exitImmediately(1), 1500);
		exitTimer.unref();
	}
}

function sanitizeProxyUrlForStorage(rawUrl: string): {
	url: string;
	hadCredentials: boolean;
	username?: string;
	password?: string;
} {
	const normalized = /^[a-z]+:\/\//i.test(rawUrl.trim())
		? rawUrl.trim()
		: `http://${rawUrl.trim()}`;
	const parsed = new URL(normalized);
	const hadCredentials = Boolean(parsed.username || parsed.password);
	const username = parsed.username
		? decodeURIComponent(parsed.username)
		: undefined;
	const password = parsed.password
		? decodeURIComponent(parsed.password)
		: undefined;
	parsed.username = "";
	parsed.password = "";
	return { url: parsed.toString(), hadCredentials, username, password };
}

function redactProxyUrl(rawUrl: string): string {
	try {
		return sanitizeProxyUrlForStorage(rawUrl).url;
	} catch {
		return rawUrl.replace(/\/\/[^:@/\s]+:[^@/\s]+@/u, "//[REDACTED]@");
	}
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
			throw commandFailed();
		}
	} finally {
		store.close();
	}
}

function printHelp(): void {
	console.log(`
Browser Control CLI

Usage: bc <command> [subcommand] [options]

Automation Packages (primary):
  package record start --name=<name> [--domain=<domain>] [--json]     Start a package recording session
  package record action <kind> --params=<json> [--json]               Add an explicit action to the active recording
  package record stop [--json]                                        Stop the active package recording
  package draft <recording-id> [--json]                               Draft package files from a recording
  package materialize <recording-id> [--overwrite] [--install] [--json] Materialize a recording as a package draft
  package install <source> [--json]                                  Install a package from local directory
  package list [--json]                                              List installed packages
  package info <name> [--json]                                       Show package info
  package grant <name> <permission-kind-or-index> [--json]            Grant a declared package permission
  package run <name> <workflow> [--json]                             Run a package workflow
  package eval <name> [--json]                                       Evaluate a package
  package review <name> <approved|rejected|pending> [--by=<name>] [--reason=<text>] [--json] Record package trust review
  package review-history <name> [--json]                             Show package trust review history
  package eval-history [name] [--json]                               Show package evaluation history
  package sign <source> [--private-key=<pem>] [--signer=<name>] [--json] Compute package digest and optional signature

Operator:
  doctor [--json]                                                    Run operator diagnostics
  setup [--json] [--non-interactive] [--profile=balanced] [--browser-mode=managed|attach]
        [--chrome-debug-port=9222] [--chrome-bind-address=127.0.0.1]
        [--terminal-shell=pwsh] [--browserless-endpoint=<url>]
        [--browserless-api-key=<key>] [--skip-browser-test] [--skip-terminal-test]
                                                                      Create/update user config
  config list|get|set                                                Inspect or update effective config
  status [--json]                                                    Show daemon, broker, sessions, tasks, and health
  data doctor [--cleanup] | cleanup [--stale] | export [--json]        Inspect, clean, or export local data home
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
  workflow events <runId> [--json]                                   Show workflow run events
  workflow edit-state <runId> <key> <value> [--json]                 Edit workflow run state
  workflow resume <runId> [--json]                                   Resume a workflow run
  workflow approve <runId> <nodeId> [--json]                         Approve a workflow node
  workflow cancel <runId> [--json]                                   Cancel a workflow run

Self-Healing Harness (Section 29):
  harness list [--json]                                              List registered helpers
  harness validate <helperId> [--json]                               Validate a helper
  harness rollback <helperId> <version> [--json]                     Rollback a helper
  harness generate --id=<id> --purpose=<purpose> [--files=<path:content>] [--json]
                                                                     Generate a helper
  harness execute <helperId> [--input='<json>'] [--json]             Execute a helper

Browser Actions:
  open <url>                                                         Open a URL in the browser
  snapshot                                                           Take an accessibility snapshot
  click <ref-or-target>                                              Click an element (ref, selector, or text)
  fill <ref-or-target> <text>                                        Fill an element with text
  hover <ref-or-target>                                             Hover over an element
  type <text>                                                        Type text into focused element
  paste <text> [--target=<ref-or-target>]                            Paste/insert text into focused element
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
  browser open <url> [--json]                                       Open/navigate browser tab
  browser snapshot [--boxes] [--json]                                Take accessibility snapshot
  browser state [--snapshot] [--screenshot] [--downloads] [--json]   Return compact browser state
  browser act <action> [target] [text] [--text=<text>] [--url=<url>] [--timeout=<ms>] [--capture-on-success] [--json]
                                                                      Run one composite browser action
  browser task run --steps='<json>' [--continue-on-failure] [--json] Run multiple browser/fs-output steps
  browser provider list                                              List browser providers
  browser provider catalog                                           List supported browser provider types
  browser provider use <name>                                        Set active browser provider
  browser provider add <name> --type=<type> [--endpoint=<url>]       Add or configure a browser provider
  browser provider remove <name>                                     Remove a configured browser provider
  browser provider health [name]                                     Run provider health diagnostics
  browser profile list                                                List browser profiles
  browser profile create <name> [--type=named]                       Create a browser profile
  browser profile use <name>                                          Activate a browser profile
  browser profile delete <name>                                       Delete a browser profile
  browser auth export [--live | --stored] [--profile=default] [--output=<file>] [--yes]
                                                                      Export auth state (cookies/storage)
  browser auth import <file> [--live | --stored] [--profile=default] [--yes]
                                                                      Import auth state from file
  run --package=<name> --workflow=<name> [--params='{"key":"value"}'] Run an Automation Package workflow
  schedule <id> --cron="*/5 * * * *" --package=<name> --workflow=<name> Schedule an Automation Package workflow
  schedule list                                                      List scheduled tasks
  schedule pause <id>                                                Pause a scheduled task
  schedule resume <id>                                               Resume a scheduled task
  schedule remove <id>                                               Remove a scheduled task
  daemon start [--visible]                                           Start the daemon
  daemon stop                                                        Stop the daemon
  daemon status                                                      Check daemon status
  daemon health                                                      Run health checks
  daemon logs                                                        View daemon logs
  memory stats                                                       Show memory stats
  memory clear                                                       Clear memory
  memory get <key>                                                   Get a memory key
  memory set <key> <value>                                           Set a memory key
  report generate                                                    Generate report
  report view                                                        View report
  policy list                                                        List built-in policy profiles
  policy inspect <name>                                              Inspect a policy profile
  policy export <name> [file]                                         Export a policy profile to JSON
  policy import <file>                                               Import a custom policy profile
  knowledge list [--kind=interaction-skill|domain-skill]             List internal knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or package
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact
  knowledge backends [list|health|search|rank]                       Manage knowledge backends
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
  service proxy status                                                Show .localhost proxy status
  service proxy start [--port=80|0] [--allow-remote=true] [--background=true] [--https=true --cert=<pem> --key=<pem>|--local-ca=true] Start .localhost proxy
  service proxy stop                                                  Stop managed .localhost proxy
  service proxy startup status|install|uninstall [--port=80] [--yes] Manage per-user OS startup
  service proxy ca status|create|install|uninstall [--ca-dir=<dir>] [--rotate=true] [--yes] Manage trusted .localhost CA

Debug:
  debug bundle <id> [--output=<path>] [--yes]                          Retrieve a debug bundle
  debug console [--session=<id>]                                      Show captured console entries
  debug network [--session=<id>]                                      Show captured network entries
  debug receipt <id>                                                  Get a debug receipt by ID (Section 26)

MCP:
  mcp serve                                                           Start MCP stdio server

Knowledge:
  knowledge list [--kind=interaction-skill|domain-skill]             List internal knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or package
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact
  knowledge backends [list|health|search|rank]                       Manage knowledge backends

Flags:
  --json                                                             Raw JSON output
  --help, -h                                                         Show help

Environment:
  BROKER_PORT                                                        Broker API port (default: 7788)
`);
}

function printPackageHelp(): void {
	console.log(`
Browser Control CLI - Automation Packages

Usage: bc package <command> [options]

Create and replay reusable browser workflow packages:
  package record start --name=<name> [--domain=<domain>] [--json]     Start a package recording session
  package record action <kind> --params=<json> [--json]               Add an explicit action to the active recording
  package record stop [--json]                                        Stop the active package recording and save discovery telemetry
  package draft <recording-id> [--json]                               Draft package files from a recording
  package materialize <recording-id> [--overwrite] [--install] [--json] Materialize a recording as a package draft

Install, review, and run packages:
  package install <source> [--json]                                  Install a package from local directory
  package list [--json]                                              List installed packages
  package info <name> [--json]                                       Show package info
  package remove <name> [--json]                                     Remove an installed package
  package update <name> [source] [--json]                            Update an installed package
  package grant <name> <permission-kind-or-index> [--json]            Grant a declared package permission
  package run <name> <workflow> [--json]                             Run a package workflow and include savings telemetry
  package eval <name> [--json]                                       Evaluate a package
  package review <name> <approved|rejected|pending> [--by=<name>] [--reason=<text>] [--json] Record package trust review
  package review-history <name> [--json]                             Show package trust review history
  package eval-history [name] [--json]                               Show package evaluation history
  package sign <source> [--private-key=<pem>] [--signer=<name>] [--json] Compute package digest and optional signature

Flags:
  --json                                                             Raw JSON output
  --help, -h                                                         Show this help
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
				throw commandFailed();
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
				throw commandFailed();
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
			throw commandFailed();
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
		throw commandFailed();
	}

	const body: Record<string, unknown> = {};
	if (flags.skill) body.skill = flags.skill;
	if (flags.action) body.action = flags.action;
	if (flags.params) {
		try {
			body.params = JSON.parse(flags.params);
		} catch {
			console.error("Error: Invalid JSON in --params");
			throw commandFailed();
		}
	}
	if (flags.priority) body.priority = flags.priority;
	if (flags.timeoutMs) body.timeoutMs = Number(flags.timeoutMs);

	try {
		const result = await apiRequest("/tasks/run", "POST", body);
		outputJson(result, !jsonOutput);
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		case "pause":
		case "resume": {
			const id = positional[0];
			if (!id) {
				console.error("Error: Task ID is required");
				throw commandFailed();
			}
			try {
				const result = await apiRequest(
					`/scheduler/${id}/${subcommand}`,
					"POST",
				);
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "remove": {
			const id = positional[0];
			if (!id) {
				console.error("Error: Task ID is required");
				throw commandFailed();
			}
			try {
				const result = await apiRequest(`/scheduler/${id}`, "DELETE");
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		default: {
			// Schedule a new task: schedule <id> --cron=... --skill=... --action=...
			const id = subcommand;
			if (!id) {
				console.error("Error: Task ID is required");
				throw commandFailed();
			}
			if (!flags.cron) {
				console.error("Error: --cron is required");
				throw commandFailed();
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
					throw commandFailed();
				}
			}

			try {
				const result = await apiRequest("/tasks/schedule", "POST", body);
				outputJson(result, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
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
				throw commandFailed();
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
					throw commandFailed();
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
				throw commandFailed();
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
					throw commandFailed();
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
				throw commandFailed();
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
			throw commandFailed();
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
					results.push({ url: redactProxyUrl(config.url), status: config.status });
				}
				outputJson(results, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "add": {
			const url = positional[0];
			if (!url) {
				console.error("Error: Proxy URL is required");
				throw commandFailed();
			}

			try {
				const sanitized = sanitizeProxyUrlForStorage(url);
				let credentialRef: string | undefined;
				if (sanitized.hadCredentials) {
					const { CredentialVault } = await import("./security/credential_vault");
					const proxyScope = new URL(sanitized.url).host;
					const stored = await new CredentialVault().set(
						"site",
						proxyScope,
						"proxy-credentials",
						JSON.stringify({
							username: sanitized.username ?? "",
							password: sanitized.password ?? "",
						}),
					);
					credentialRef = stored.id;
					console.error(
						"Warning: proxy credentials were stored in the credential vault and were not written to proxies.json.",
					);
				}
				const proxyPath = path.join(process.cwd(), "proxies.json");
				let configs = [];
				if (fs.existsSync(proxyPath)) {
					configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
				}

				const existing = configs.find(
					(c: { url: string }) => c.url === sanitized.url,
				) as { credentialRef?: string } | undefined;
				if (existing) {
					if (credentialRef) {
						existing.credentialRef = credentialRef;
						fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
						console.log(`Proxy updated: ${sanitized.url}`);
						break;
					}
					console.log("Proxy already exists");
					break;
				}

				configs.push({
					url: sanitized.url,
					status: "active",
					...(credentialRef ? { credentialRef } : {}),
				});
				fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
				console.log(`Proxy added: ${sanitized.url}`);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "remove": {
			const url = positional[0];
			if (!url) {
				console.error("Error: Proxy URL is required");
				throw commandFailed();
			}

			try {
				const sanitized = sanitizeProxyUrlForStorage(url).url;
				const proxyPath = path.join(process.cwd(), "proxies.json");
				if (!fs.existsSync(proxyPath)) {
					console.log("No proxies configured");
					break;
				}

				let configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
				const initialLength = configs.length;
				configs = configs.filter(
					(c: { url: string }) => redactProxyUrl(c.url) !== sanitized,
				);

				if (configs.length === initialLength) {
					console.log("Proxy not found");
					break;
				}

				fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
				console.log(`Proxy removed: ${sanitized}`);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "list": {
			try {
				const configs = loadProxyConfigs();
				outputJson(
					configs.map((config) => ({
						...config,
						url: redactProxyUrl(config.url),
						username: config.username ? "[REDACTED]" : undefined,
						password: config.password ? "[REDACTED]" : undefined,
					})),
					!jsonOutput,
				);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		default:
			console.error(`Unknown proxy command: ${subcommand}`);
			throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				store.set(key, value);
				console.log(`Key set: ${key}`);
				break;
			}

			default:
				console.error(`Unknown memory command: ${subcommand}`);
				throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		case "health": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				throw commandFailed();
			}
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const skill = registry.get(name);
				if (!skill) {
					console.error(`Error: Skill "${name}" not found`);
					throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		case "actions": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				throw commandFailed();
			}
			try {
				const registry = await loadCliSkillRegistry(getSkillsDataDir());
				const skills = registry.list() as unknown as Array<
					Record<string, unknown>
				>;
				const skill = skills.find((s) => s.name === name);
				if (!skill) {
					console.error(`Error: Skill "${name}" not found`);
					throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		case "install": {
			const skillPath = positional[0];
			if (!skillPath) {
				console.error("Error: Path to skill directory is required");
				throw commandFailed();
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
				throw commandFailed();
			}

			const meta = loadPackagedSkillDir(skillPath);
			if (!meta) {
				console.error(`Error: Failed to load skill.yaml from "${skillPath}"`);
				throw commandFailed();
			}

			const validation = validateManifest(meta.manifest);
			if (!validation.valid) {
				console.error(`Validation failed:`);
				for (const err of validation.errors) {
					console.error(`  - ${err}`);
				}
				throw commandFailed();
			}

			const skillsDir = getSkillsDataDir();
			const result = registry.installSkill(skillPath, skillsDir);
			if (!result.success) {
				console.error(`Install failed: ${result.error}`);
				throw commandFailed();
			}
			console.log(`Skill "${result.name}" installed to ${skillsDir}`);
			break;
		}

		case "validate": {
			const nameOrPath = positional[0];
			if (!nameOrPath) {
				console.error("Error: Skill name or path is required");
				throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				const validation = validateManifest(
					skill as unknown as import("./skill").SkillManifest,
				);
				outputJson(validation, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "remove": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Skill name is required");
				throw commandFailed();
			}
			const { SkillRegistry } = await import("./skill_registry");
			const registry = new SkillRegistry();
			const skillsDir = getSkillsDataDir();
			const result = registry.removeSkill(name, skillsDir);
			if (!result.success) {
				console.error(`Remove failed: ${result.error}`);
				throw commandFailed();
			}
			console.log(`Skill "${name}" removed.`);
			break;
		}

		default:
			console.error(`Unknown skill command: ${subcommand}`);
			throw commandFailed();
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
				throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		default:
			console.error(`Unknown report command: ${subcommand}`);
			throw commandFailed();
	}
}

async function handleCaptcha(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const { loadConfig } = await import("./shared/config");

	if (subcommand !== "test") {
		console.error(`Unknown captcha command: ${subcommand}`);
		throw commandFailed();
	}

	// Captcha solving requires a browser Page which the CLI cannot provide.
	// Validate configuration instead of pretending to solve.
	const config = loadConfig({ validate: false });
	if (!config.captchaProvider) {
		console.error(
			"Error: CAPTCHA_PROVIDER is not configured. Set it in .env to enable captcha solving.",
		);
		throw commandFailed();
	}
	if (!config.captchaApiKey) {
		console.error("Error: CAPTCHA_API_KEY is not configured.");
		throw commandFailed();
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
				throw commandFailed();
			}
			const profile = getProfile(name);
			if (!profile) {
				console.error(`Error: Profile "${name}" not found`);
				throw commandFailed();
			}
			outputJson(profile, !jsonOutput);
			break;
		}

		case "export": {
			const name = positional[0];
			if (!name) {
				console.error("Error: Profile name is required");
				throw commandFailed();
			}
			const profile = getProfile(name);
			if (!profile) {
				console.error(`Error: Profile "${name}" not found`);
				throw commandFailed();
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
				throw commandFailed();
			}

			if (!fs.existsSync(filePath)) {
				console.error(`Error: File not found: ${filePath}`);
				throw commandFailed();
			}

			const content = fs.readFileSync(filePath, "utf-8");
			const profile = deserializeProfile(content);
			if (!profile) {
				console.error("Error: Failed to parse profile or validation failed");
				throw commandFailed();
			}

			const validation = validateProfile(profile);
			if (!validation.valid) {
				console.error("Validation failed:");
				for (const err of validation.errors) {
					console.error(`  - ${err}`);
				}
				throw commandFailed();
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
			throw commandFailed();
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
				throw commandFailed();
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
						throw commandFailed();
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
				throw commandFailed();
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
						throw commandFailed();
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
				throw commandFailed();
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
				throw commandFailed();
			}
			if (!files && !dataArray) {
				console.error("Error: Either --file/--files or --data is required");
				throw commandFailed();
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
						throw commandFailed();
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		// Section 27: Downloads list
		case "downloads": {
			const downloadsAction = positional[0];
			if (downloadsAction !== "list") {
				console.error(`Unknown downloads command: ${downloadsAction}`);
				console.error("Available: list");
				throw commandFailed();
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
						throw commandFailed();
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "launch": {
			const port = flags.port ? Number(flags.port) : undefined;
			const profileName = flags.profile ?? "default";
			const provider = flags.provider ?? undefined;
			const allowSystemProfile = flags["allow-system-profile"] === "true" ||
				process.env.BROWSER_CONTROL_ALLOW_SYSTEM_PROFILE === "1";

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

				// Treat "shared" profile as needing explicit opt-in
				const profileType = flags["profile-type"] ?? (allowSystemProfile ? "shared" : "isolated");
				if (profileType !== "isolated" && !allowSystemProfile) {
					console.warn(
						"Warning: System/shared profile requires --allow-system-profile flag or " +
						"BROWSER_CONTROL_ALLOW_SYSTEM_PROFILE=1 env var. Defaulting to isolated profile.",
					);
				}
				if (profileType !== "isolated" && allowSystemProfile) {
					console.warn("Warning: Using system/shared Chrome profile — data may persist across sessions.");
				}

				const connection = await manager.launchManaged({
					port,
					profileName,
					profileType: profileType as "shared" | "isolated" | "named",
					actor: "human",
					provider,
					allowSystemProfile,
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
				throw commandFailed();
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
				throw commandFailed();
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
				case "catalog": {
					await requireCliPolicy("browser_provider_catalog", {}, jsonOutput);
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const result = registry.catalog();
					if (jsonOutput) {
						outputJson(result);
					} else {
						console.log("Browser provider catalog:");
						for (const entry of result) {
							const flags = [
								entry.remote ? "remote" : "local",
								`risk=${entry.risk}`,
								entry.requiresEndpoint ? "endpoint" : "no endpoint",
								entry.requiresAuth ? "credential" : "no credential",
							].join(", ");
							console.log(`  ${entry.name}: ${entry.label} (${flags})`);
							console.log(`    ${entry.description}`);
						}
					}
					break;
				}
				case "use": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						throw commandFailed();
					}
					await requireCliPolicy(
						"browser_provider_use",
						{ name },
						jsonOutput,
						flags.yes === "true",
					);
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
							throw commandFailed();
						}
					}
					break;
				}
				case "add": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						throw commandFailed();
					}
					const providerType = flags.type as ProviderConfig["type"] | undefined;
					const endpoint = flags.endpoint as string | undefined;
					const apiKey = flags["api-key"] as string | undefined;
					const validProviderTypes: ProviderConfig["type"][] = [
						"browserless",
						"browserbase",
						"custom",
						"e2b",
						"cubesandbox",
						"camofox",
						"cloak",
						"obscura",
					];
					if (!providerType) {
						console.error(
							"Error: --type is required (browserless, browserbase, custom, e2b, cubesandbox, camofox, cloak, obscura)",
						);
						throw commandFailed();
					}
					if (!validProviderTypes.includes(providerType)) {
						console.error(
							`Error: Invalid provider type "${providerType}". Must be browserless, browserbase, custom, e2b, cubesandbox, camofox, cloak, or obscura.`,
						);
						throw commandFailed();
					}
					if (!endpoint && providerType !== "browserbase") {
						console.error("Error: --endpoint is required");
						throw commandFailed();
					}
					await requireCliPolicy(
						"browser_provider_add",
						{ name, type: providerType, endpoint },
						jsonOutput,
						flags.yes === "true",
					);
					const { ProviderRegistry } = await import("./providers/registry");
					const registry = new ProviderRegistry();
					const config: ProviderConfig = {
						name,
						type: providerType,
					};
					if (endpoint) config.endpoint = endpoint;
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
							throw commandFailed();
						}
					}
					break;
				}
				case "health": {
					await requireCliPolicy(
						"browser_provider_health",
						{ name: positional[1] },
						jsonOutput,
					);
					const { ProviderRegistry } = await import("./providers/registry");
					const { checkProviderHealth } = await import("./providers/health");
					const registry = new ProviderRegistry();
					const listed = registry.list();
					const names = positional[1]
						? [positional[1]]
						: [
							...new Set([
								...listed.builtIn,
								...listed.providers.map((provider) => provider.name),
							]),
						];
					const reports = [];
					for (const providerName of names) {
						const config = registry.get(providerName);
						if (config) reports.push(await checkProviderHealth(config));
					}
					if (jsonOutput) {
						outputJson(reports);
					} else {
						for (const report of reports) {
							console.log(
								`${report.name} (${report.type}): ${report.state} score=${report.score} latency=${report.latencyMs}ms`,
							);
							console.log(`  ${report.summary}`);
						}
					}
					break;
				}
				case "remove": {
					const name = positional[1];
					if (!name) {
						console.error("Error: Provider name is required");
						throw commandFailed();
					}
					await requireCliPolicy(
						"browser_provider_remove",
						{ name },
						jsonOutput,
						flags.yes === "true",
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
							throw commandFailed();
						}
					}
					break;
				}
				default:
					console.error(`Unknown browser provider command: ${providerAction}`);
					console.error("Available: list, use, add, remove");
					throw commandFailed();
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
						throw commandFailed();
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
						throw commandFailed();
					}
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const profile = pm.getProfileByName(name);
					if (!profile) {
						console.error(`Error: Profile "${name}" not found`);
						throw commandFailed();
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
						throw commandFailed();
					}
					const { BrowserProfileManager } = await import("./browser/profiles");
					const pm = new BrowserProfileManager();
					const deleted = pm.deleteProfileByName(name);
					if (!deleted) {
						console.error(
							`Error: Profile "${name}" not found or cannot be deleted`,
						);
						throw commandFailed();
					}
					console.log(`Profile "${name}" deleted.`);
					break;
				}

				default:
					console.error(`Unknown browser profile command: ${profileAction}`);
					console.error("Available: list, create, use, delete");
					throw commandFailed();
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
						throw commandFailed();
					}
					if (isLive && isStored) {
						console.error("Error: Cannot specify both --live and --stored.");
						throw commandFailed();
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
								throw commandFailed();
							}
							const activeProfileId = activeSession.profileId;
							if (!activeProfileId) {
								store.close();
								console.error(
									"Error: Active browser state is missing a profile id.",
								);
								throw commandFailed();
							}
							const activeProfileName = pm.getProfile(activeProfileId)?.name;

							if (profileName && profileName !== activeProfileName) {
								store.close();
								console.error(
									`Error: Active browser is running profile "${activeProfileName}", but you requested "${profileName}".`,
								);
								throw commandFailed();
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
								throw commandFailed();
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
								throw commandFailed();
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
						throw commandFailed();
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
						throw commandFailed();
					}
					if (!fs.existsSync(filePath)) {
						console.error(`Error: File not found: ${filePath}`);
						throw commandFailed();
					}
					if (!isLive && !isStored) {
						console.error(
							"Error: You must specify either --live (to inject into the active browser) or --stored (to update offline memory snapshot).",
						);
						throw commandFailed();
					}
					if (isLive && isStored) {
						console.error("Error: Cannot specify both --live and --stored.");
						throw commandFailed();
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
								throw commandFailed();
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
								throw commandFailed();
							}
							if (activeSession.profileId !== profileId) {
								store.close();
								console.error(
									`Error: Active browser is running profile "${activeSession.profileId}", but snapshot is for "${profileId}".`,
								);
								throw commandFailed();
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
						throw commandFailed();
					}
					break;
				}

				default:
					console.error(`Unknown browser auth command: ${authAction}`);
					console.error("Available: export, import");
					throw commandFailed();
			}
			break;
		}

		case "highlight": {
			const target = positional[0];
			if (!target) {
				console.error("Error: Target (ref, selector, or text) is required");
				throw commandFailed();
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
						throw commandFailed();
					}
				}
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "open-many":
		case "openMany": {
			const urls = flags.urls ? JSON.parse(flags.urls) : undefined;
			if (!Array.isArray(urls) || urls.length === 0) {
				console.error("Error: --urls is required (JSON array)");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.act({
						action: "openMany",
						urls,
						waitUntil: parseWaitUntil(flags["wait-until"]),
					}),
					timeoutMs ? Number(timeoutMs) : 60_000,
					"browser open-many",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "open": {
			const url = positional[0] ?? flags.url;
			if (!url) {
				console.error("Error: URL is required");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.act({
						action: "open",
						url,
						waitUntil: parseWaitUntil(flags["wait-until"]),
					}),
					timeoutMs ? Number(timeoutMs) : 60_000,
					"browser open",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "navigate": {
			const url = positional[0] ?? flags.url;
			if (!url) {
				console.error("Error: URL is required");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.act({
						action: "navigate",
						url,
						tabId: flags.tab ?? flags["tab-id"] ?? flags.tabId,
						waitUntil: parseWaitUntil(flags["wait-until"]),
					}),
					timeoutMs ? Number(timeoutMs) : 60_000,
					"browser navigate",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "capture": {
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.act({
						action: "capture",
						tabId: flags.tab ?? flags["tab-id"] ?? flags.tabId,
						snapshot: flags.snapshot ? flags.snapshot !== "false" : undefined,
						screenshot: flags.screenshot === "true",
					}),
					timeoutMs ? Number(timeoutMs) : 60_000,
					"browser capture",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "capture-many":
		case "captureMany": {
			const tabIds = flags["tab-ids"]
				? flags["tab-ids"].split(",").map((item) => item.trim()).filter(Boolean)
				: flags.urls
					? JSON.parse(flags.urls)
					: undefined;
			if (!Array.isArray(tabIds) || tabIds.length === 0) {
				console.error("Error: --tab-ids or --urls is required");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.act({
						action: "captureMany",
						urls: tabIds,
						snapshot: flags.snapshot ? flags.snapshot !== "false" : undefined,
						screenshot: flags.screenshot === "true",
					}),
					timeoutMs ? Number(timeoutMs) : 60_000,
					"browser capture-many",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "snapshot": {
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.snapshot({
						tabId: flags.tab ?? flags["tab-id"] ?? flags.tabId,
						boxes: flags.boxes === "true",
						rootSelector: flags["root-selector"],
					}),
					timeoutMs ? Number(timeoutMs) : 30_000,
					"browser snapshot",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		// Section 31: Compact browser state
		case "state": {
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(
					bc.browser.state({
						tabId: flags.tab ?? flags["tab-id"] ?? flags.tabId,
						snapshot: flags.snapshot === "true",
						screenshot: flags.screenshot === "true",
						fullPage: flags["full-page"] === "true" || flags.fullPage === "true",
						dialog: flags.dialog !== "false",
						downloads: flags.downloads === "true",
					}),
					timeoutMs ? Number(timeoutMs) : 30_000,
					"browser state",
				);
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		// Section 31: Unified action
		case "act": {
			const action = positional[0];
			if (!action) {
				console.error("Error: Action is required (click, fill, press, hover, scroll, type, paste, screenshot, tab-close, open, navigate, openMany, capture, captureMany, fillMany, state)");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const fields = flags.fields ? JSON.parse(flags.fields) : undefined;
				const urls = flags.urls ? JSON.parse(flags.urls) : undefined;
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(bc.browser.act({
					action: action as any,
					target: positional[1] ?? flags.target,
					text: flags.text ?? positional[2],
					key: flags.key,
					timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
					force: flags.force === "true",
					commit: flags.commit === "true",
					direction: flags.direction,
					amount: flags.amount ? Number(flags.amount) : undefined,
					delayMs: flags.delayMs ? Number(flags.delayMs) : undefined,
					tabId: flags.tab ?? flags["tab-id"] ?? flags.tabId,
					captureOnSuccess:
						flags.capture === "true" || flags["capture-on-success"] === "true" || flags.captureOnSuccess === "true",
					outputPath: flags.output ?? flags["output-path"] ?? flags.outputPath,
					url: flags.url,
					urls,
					waitUntil: flags["wait-until"] as any,
					fields,
					continueOnFailure: flags["continue-on-failure"] === "true",
					boxes: flags.boxes === "true",
					rootSelector: flags["root-selector"],
					snapshot: flags.snapshot ? flags.snapshot !== "false" : undefined,
					screenshot: flags.screenshot === "true",
				}), timeoutMs ? Number(timeoutMs) : 30_000, "browser act");
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		// Section 31: Multi-step task runner
		case "task": {
			const taskAction = positional[0];
			if (taskAction !== "run") {
				console.error("Error: Use 'task run --steps=<json>'");
				throw commandFailed();
			}
			const stepsRaw = flags.steps;
			if (!stepsRaw) {
				console.error("Error: --steps is required (JSON array of step objects)");
				throw commandFailed();
			}
			let steps: any[];
			try {
				steps = JSON.parse(stepsRaw);
			} catch {
				console.error("Error: --steps must be valid JSON");
				throw commandFailed();
			}
			try {
				const { createBrowserControl } = await import("./browser_control");
				const bc = createBrowserControl();
				const timeoutMs = flags.timeoutMs ?? flags.timeout;
				const { result, timedOut } = await withCliTimeout(bc.browser.taskRun({
					steps,
					continueOnFailure: flags["continue-on-failure"] === "true",
				}), timeoutMs ? Number(timeoutMs) : 30_000, "browser task run");
				outputJson(result, !jsonOutput);
				await cleanupBrowserSession(bc, timedOut);
				await finishTimedCliResult(timedOut);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		case "tab": {
			const tabArgs: ParsedArgs = {
				...args,
				command: "tab",
				subcommand: positional[0],
				positional: positional.slice(1),
			};
			await handleBrowserAction("tab", tabArgs);
			break;
		}

		default:
			console.error(`Unknown browser command: ${subcommand}`);
			console.error(
				"Available: attach, launch, status, profile, auth, highlight, state, act, task, tab, open-many, navigate, capture, capture-many",
			);
			throw commandFailed();
	}
}

export async function runCli(argv = process.argv): Promise<void> {
	const args = parseArgs(argv);

	if (args.flags.help || args.flags.h || args.command === "help") {
		if (args.command === "package") {
			printPackageHelp();
			return;
		}
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

	process.exitCode = 0;
	cliErrorContext = undefined;
	const previousConsoleError = console.error;
	console.error = (...innerArgs: unknown[]) => {
		rememberCliErrorContext(innerArgs);
		previousConsoleError(...innerArgs);
	};

	try {
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

			case "vault":
				await handleVault(args);
				break;

			case "network":
				await handleNetwork(args);
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

			case "paste":
				await handleBrowserAction("paste", args);
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
				throw new CliError("Unknown command");
		}

	} finally {
		console.error = previousConsoleError;
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
				throw commandFailed();
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				throw commandFailed();
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

			if (!allValid) throw commandFailed();
			break;
		}

		case "prune": {
			// Prune removes stale entries (not full delete)
			const nameOrDomain = positional[0];
			if (!nameOrDomain) {
				console.error("Error: Name or domain is required");
				throw commandFailed();
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				throw commandFailed();
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
				throw commandFailed();
			}

			let artifact = findByDomain(nameOrDomain);
			if (!artifact) artifact = findByName(nameOrDomain);

			if (!artifact) {
				console.error(`Error: No knowledge found for "${nameOrDomain}"`);
				throw commandFailed();
			}

			const deleted = deleteArtifact(artifact.filePath);
			if (deleted) {
				console.log(`Deleted: ${artifact.filePath}`);
			} else {
				console.error(`Error: Failed to delete ${artifact.filePath}`);
				throw commandFailed();
			}
			break;
		}

		case "backends": {
			const backendSubcommand = positional[0] ?? "list";
			const { getKnowledgeBackendCatalog, createKnowledgeBackend } = await import("./knowledge/backends");

			switch (backendSubcommand) {
				case "list": {
					const catalog = getKnowledgeBackendCatalog();
					if (jsonOutput) {
						outputJson(catalog, false);
					} else {
						console.log("Knowledge Backend Catalog:\n");
						for (const entry of catalog) {
							const defaultTag = entry.default ? " [default]" : "";
							const remoteTag = entry.remote ? " [remote]" : "";
							const statusTag = entry.status === "extension-point" ? " [extension]" : "";
							console.log(`  ${entry.type}${defaultTag}${remoteTag}${statusTag}`);
							console.log(`    Label: ${entry.label}`);
							console.log(`    Hint:  ${entry.setupHint}`);
							console.log();
						}
					}
					break;
				}

				case "health": {
					const type = flags.type as string | undefined;
					const endpoint = flags.endpoint as string | undefined;
					const apiKey = flags["api-key"] as string | undefined;

					if (type) {
						const backend = createKnowledgeBackend({
							type: type as never,
							endpoint,
							apiKey,
						});
						const health = await backend.health();
						if (jsonOutput) {
							outputJson(health, false);
						} else {
							const status = health.ok ? "OK" : "FAIL";
							console.log(`${status} ${health.type}: ${health.summary}`);
							console.log(`Checked: ${health.checkedAt}`);
						}
						if (!health.ok) throw commandFailed();
					} else {
						const catalog = getKnowledgeBackendCatalog();
						const results = await Promise.all(
							catalog.map(async (entry) => {
								const backend = createKnowledgeBackend({ type: entry.type });
								return backend.health();
							}),
						);
						if (jsonOutput) {
							outputJson(results, false);
						} else {
							console.log("Knowledge Backend Health Checks:\n");
							for (const health of results) {
								const status = health.ok ? "OK" : "FAIL";
								console.log(`  ${status} ${health.type}: ${health.summary}`);
							}
						}
					}
					break;
				}

				case "search": {
					const query = flags.query as string | undefined;
					const domain = flags.domain as string | undefined;
					const type = flags.type as string | undefined;

					if (!query && !domain) {
						console.error("Error: --query or --domain is required");
						throw commandFailed();
					}

					const backend = createKnowledgeBackend({
						type: (type as never) ?? "local-markdown",
						endpoint: flags.endpoint as string | undefined,
						apiKey: flags["api-key"] as string | undefined,
					});
					const results = await backend.search({
						search: query,
						domain,
					});
					if (jsonOutput) {
						outputJson(results, false);
					} else {
						console.log(`Search results (${results.length}):\n`);
						for (const r of results) {
							console.log(`  ${r.summary.kind}: ${r.summary.identifier}`);
							console.log(`    Verified: ${r.summary.verified}`);
							console.log(`    Entries:  ${r.summary.entryCount}`);
							console.log();
						}
					}
					break;
				}

				case "rank": {
					const query = flags.query as string | undefined;
					const domain = flags.domain as string | undefined;
					const entryType = flags["entry-type"] as string | undefined;
					const limit = flags.limit ? Number(flags.limit) : 10;

					if (!query) {
						console.error("Error: --query is required");
						throw commandFailed();
					}

					const backend = createKnowledgeBackend({
						type: ((flags.type as string) ?? "local-markdown") as never,
						endpoint: flags.endpoint as string | undefined,
						apiKey: flags["api-key"] as string | undefined,
					});
					const ranked = await backend.rankEntries({
						domain,
						query,
						entryType: entryType as never,
						limit: Number.isFinite(limit) ? limit : undefined,
					});
					if (jsonOutput) {
						outputJson(ranked, false);
					} else {
						console.log(`Ranked results (${ranked.length}):\n`);
						for (const r of ranked) {
							console.log(`  [${r.score.toFixed(1)}] ${r.domain}: ${r.entry.description}`);
							if (r.entry.selector) console.log(`    selector: ${r.entry.selector}`);
							console.log(`    reasons: ${r.reasons.join(", ")}`);
							console.log();
						}
					}
					break;
				}

				default:
					console.error(`Unknown backends command: ${backendSubcommand}`);
					console.error("Supported: list, health, search, rank");
					throw commandFailed();
			}
			break;
		}

		default:
			console.error(`Unknown knowledge command: ${subcommand}`);
			console.error("Supported: list, show, validate, prune, delete");
			throw commandFailed();
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
			throw commandFailed();
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
			throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				if (!sessionId) {
					console.error("Error: --session is required for 'term type'");
					throw commandFailed();
				}
				result = await terminalActions.type({ text, sessionId });
				break;
			}

			case "read": {
				const sessionId = flags.session;
				if (!sessionId) {
					console.error("Error: --session is required for 'term read'");
					throw commandFailed();
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
					throw commandFailed();
				}
				result = await terminalActions.interrupt({ sessionId });
				break;
			}

			case "close": {
				const sessionId = flags.session;
				if (!sessionId) {
					console.error("Error: --session is required for 'term close'");
					throw commandFailed();
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
					throw commandFailed();
				}
				result = await terminalActions.resume({ sessionId });
				break;
			}

			case "status": {
				const sessionId = positional[0] || flags.session;
				if (!sessionId) {
					console.error("Error: session ID is required for 'term status'");
					throw commandFailed();
				}
				result = await terminalActions.status({ sessionId });
				break;
			}

			case "view": {
				const sessionId = positional[0] || flags.session;
				if (!sessionId) {
					console.error("Error: session ID is required for 'term view'");
					throw commandFailed();
				}
				result = await terminalActions.snapshot({ sessionId });
				break;
			}

			default:
				console.error(`Unknown term command: ${subcommand}`);
				throw commandFailed();
		}

		if (result) {
			if (jsonOutput) {
				fs.writeSync(1, `${JSON.stringify(formatActionResult(result))}\n`);
				await closeFetchDispatcher();
				process.exitCode = 0;
				return;
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
					throw commandFailed();
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				result = await fsActions.move({ src, dst, confirmed });
				break;
			}

			case "rm": {
				const targetPath = positional[0];
				if (!targetPath) {
					console.error("Error: Path is required");
					throw commandFailed();
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
					throw commandFailed();
				}
				result = await fsActions.stat({ path: targetPath });
				break;
			}

			default:
				console.error(`Unknown fs command: ${subcommand}`);
				throw commandFailed();
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
					throw commandFailed();
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
	}
}

// ── Dashboard Handler (Section 28) ──────────────────────────────────

function isAddrInUseError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}

async function tryReuseWebServer(options: {
	host: string;
	port: number;
}): Promise<
	| {
		host: string;
		port: number;
		token: string;
		url: string;
		pid: number;
		startedAt: string;
	}
	| null
> {
	const { readActivePersistedWebAppServerInfo } = await import("./web/server");
	return readActivePersistedWebAppServerInfo({
		expectedHost: options.host,
		expectedPort: options.port,
	});
}

async function formatBusyWebPortMessage(
	port: number,
	host: string,
): Promise<string> {
	const { describeListeningProcess } = await import("./web/server");
	const owner = await describeListeningProcess(port);
	const lines = [
		`Browser Control web app port ${port} is busy on ${host}.`,
	];
	if (owner) {
		lines.push(`Listener: ${owner}`);
	}
	lines.push("Run `bc web open --port=0` to start on a free port.");
	lines.push("Source checkout: `npm run cli -- web open --port=0`.");
	return lines.join("\n");
}

async function canBindWebPort(host: string, port: number): Promise<boolean> {
	if (port === 0) return true;
	const net = await import("node:net");
	return await new Promise<boolean>((resolve) => {
		const server = net.createServer();
		let settled = false;
		const finish = (available: boolean) => {
			if (settled) return;
			settled = true;
			server.removeAllListeners();
			if (server.listening) {
				server.close(() => resolve(available));
				return;
			}
			resolve(available);
		};
		server.once("error", () => finish(false));
		server.listen(port, host, () => finish(true));
	});
}

function currentCliSpawnArgs(): string[] {
	const sourceCli = path.resolve(process.cwd(), "src", "cli.ts");
	const distCli = path.resolve(process.cwd(), "dist", "cli.js");
	const argvEntry = process.argv
		.map((arg) => path.resolve(process.cwd(), arg))
		.find((arg) => path.normalize(arg) === path.normalize(sourceCli));
	if (argvEntry || process.argv.some((arg) => /ts-node[\\/](?:dist[\\/])?bin/u.test(arg))) {
		return [
			"--require",
			"ts-node/register",
			"--require",
			"tsconfig-paths/register",
			sourceCli,
		];
	}
	if (fs.existsSync(distCli)) return [distCli];
	return [
		"--require",
		"ts-node/register",
		"--require",
		"tsconfig-paths/register",
		sourceCli,
	];
}

async function waitForReachableWebUrl(
	url: string,
	token: string,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const health = await fetch(`${url}/healthz`);
			const capabilities = await fetch(`${url}/api/capabilities`, {
				headers: { authorization: `Bearer ${token}` },
			});
			if (health.ok && capabilities.ok) return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Web server started but did not become reachable: ${errorMessage(lastError)}`,
	);
}

async function startBackgroundWebServer(options: {
	host: string;
	port: number;
	token: string;
	allowRemote: boolean;
}): Promise<{
	host: string;
	port: number;
	token: string;
	url: string;
	pid: number;
	startedAt: string;
}> {
	const { spawn } = await import("node:child_process");
	const { getDataHome } = await import("./shared/paths");
	if (!(await canBindWebPort(options.host, options.port))) {
		throw new Error(await formatBusyWebPortMessage(options.port, options.host));
	}
	const bgArgs = [
		...currentCliSpawnArgs(),
		"web",
		"serve",
		"--json",
		"--host",
		options.host,
		"--port",
		String(options.port),
		"--token",
		options.token,
	];
	if (options.allowRemote) bgArgs.push("--allow-remote");
	const bgChild = spawn(process.execPath, bgArgs, {
		stdio: "ignore",
		detached: true,
	});
	bgChild.unref();
	const recordPath = path.join(getDataHome(), "runtime", "web-server.json");
	const serverInfo = await new Promise<Record<string, unknown>>(
		(resolve, reject) => {
			let childExited = false;
			const cleanup = () => {
				clearTimeout(timeout);
				bgChild.off("exit", onExit);
			};
			const onExit = (code: number | null) => {
				childExited = true;
				cleanup();
				reject(
					new Error(
						`Background web server exited before readiness (code ${code ?? "unknown"}).`,
					),
				);
			};
			const timeout = setTimeout(() => {
				cleanup();
				if (!childExited) bgChild.kill();
				reject(new Error("Web server did not start within 10s"));
			}, 10_000);
			bgChild.once("exit", onExit);
			const poll = () => {
				try {
					if (fs.existsSync(recordPath)) {
						const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8"));
						if (
							parsed?.token === options.token &&
							parsed?.pid === bgChild.pid &&
							parsed?.port &&
							(options.port === 0 || parsed.port === options.port)
						) {
							cleanup();
							resolve(parsed);
							return;
						}
					}
				} catch {
					/* not ready yet */
				}
				setTimeout(poll, 100);
			};
			poll();
		},
	);
	const result = {
		host: serverInfo.host as string,
		port: serverInfo.port as number,
		token: serverInfo.token as string,
		url: serverInfo.url as string,
		pid: bgChild.pid!,
		startedAt: serverInfo.startedAt as string,
	};
	await waitForReachableWebUrl(result.url, result.token);
	return result;
}

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
				throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}
		default:
			console.error(`Unknown dashboard command: ${subcommand}`);
			console.error("Available: status, open");
			throw commandFailed();
	}
}

async function handleWeb(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "serve";

	switch (action) {
		case "serve":
		case "open": {
			const { createWebAppServer, openUrlInDefaultBrowser } = await import(
				"./web/server"
			);
			const { createLocalToken } = await import("./web/security");
			const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
			const port = typeof flags.port === "string" ? Number(flags.port) : 7790;
			const token = typeof flags.token === "string" ? flags.token : undefined;
			const emitInfo = (info: {
				host: string;
				port: number;
				token: string;
				url: string;
				pid?: number;
				startedAt?: string;
			}) => {
				const openUrl = `${info.url}/#token=${info.token}`;
				if (jsonOutput) {
					outputJson({ success: true, ...info, openUrl }, false);
				} else {
					console.log(`Browser Control web app: ${openUrl}`);
				}
				return openUrl;
			};

			try {
				if (action === "open" && token === undefined && port !== 0) {
					const reusable = await tryReuseWebServer({ host, port });
					if (reusable) {
						const openUrl = emitInfo(reusable);
						if (!jsonOutput) openUrlInDefaultBrowser(openUrl);
						return;
					}
				}

				if (action === "open" && flags.wait !== "true") {
					const bgToken = token || createLocalToken();
					let info: {
						host: string;
						port: number;
						token: string;
						url: string;
						pid?: number;
						startedAt?: string;
					};
					try {
						info = await startBackgroundWebServer({
							host,
							port,
							token: bgToken,
							allowRemote: flags["allow-remote"] === "true",
						});
					} catch (error) {
						if (token === undefined && port !== 0) {
							const reusable = await tryReuseWebServer({ host, port });
							if (reusable) {
								info = reusable;
							} else {
								throw error;
							}
						} else {
							throw error;
						}
					}
					const openUrl = emitInfo(info);
					if (!jsonOutput) openUrlInDefaultBrowser(openUrl);
					return;
				}

				const server = createWebAppServer({
					host,
					port,
					token,
					allowRemote: flags["allow-remote"] === "true",
				});
				try {
					const info = await server.listen();
					const openUrl = emitInfo(info);
					if (!jsonOutput) {
						if (action === "open") openUrlInDefaultBrowser(openUrl);
						console.log("Press Ctrl+C to stop.");
					}
					// Block forever — the server stays alive until killed.
					await new Promise<void>(() => undefined);
					break;
				} catch (error: unknown) {
					await server.close().catch(() => undefined);
					if (isAddrInUseError(error)) {
						if (action === "open" && token === undefined && port !== 0) {
							const reusable = await tryReuseWebServer({ host, port });
							if (reusable) {
								const openUrl = emitInfo(reusable);
								if (!jsonOutput) openUrlInDefaultBrowser(openUrl);
								return;
							}
						}
						throw new Error(await formatBusyWebPortMessage(port, host));
					}
					throw error;
				}
			} catch (error: unknown) {
				console.error("Error:", errorMessage(error));
				throw commandFailed();
			}
			break;
		}
		default:
			console.error(`Unknown web command: ${action}`);
			console.error("Available: serve, open");
			throw commandFailed();
	}
}

async function handleData(args: ParsedArgs): Promise<void> {
	const { subcommand, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "doctor";
	const { cleanupDataHome, exportDataHome, formatDataHomeReport, inspectDataHome } =
		await import("./data_home");
	const runCleanup = (): void => {
		const dryRunRequested = flags["dry-run"] === "false";
		const confirm = flags.confirm;
		const includeStaleLegacy = flags.stale === "true";
		const requiredConfirm = includeStaleLegacy ? "MOVE_STALE_LEGACY" : "DELETE_RUNTIME_TEMP";
		const dryRun = !dryRunRequested || confirm !== requiredConfirm;

		if (dryRunRequested && confirm !== requiredConfirm) {
			console.error(
				"Error: Destructive cleanup requires explicit confirmation.",
			);
			console.error(
				includeStaleLegacy
					? "Use: data cleanup --stale --dry-run=false --confirm=MOVE_STALE_LEGACY"
					: "Use: data cleanup --dry-run=false --confirm=DELETE_RUNTIME_TEMP",
			);
			throw commandFailed();
		}

		const result = cleanupDataHome(undefined, { dryRun, confirm, includeStaleLegacy });
		if (jsonOutput) outputJson(result, false);
		else {
			console.log(
				`${result.dryRun ? "Dry run" : "Cleanup"}: ${result.candidates.length} candidates, ${result.deleted.length} deleted, ${result.moved.length} moved, ${result.reclaimedBytes} bytes reclaimed.`,
			);
			if (result.dryRun && dryRunRequested) {
				console.log(
					"Note: This was a dry run because confirmation was invalid or missing.",
				);
			}
		}
	};

	switch (action) {
		case "doctor": {
			if (flags.cleanup === "true") {
				runCleanup();
				return;
			}
			const report = inspectDataHome();
			if (jsonOutput) outputJson(report, false);
			else console.log(formatDataHomeReport(report));
			return;
		}
		case "cleanup": {
			runCleanup();
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
			throw commandFailed();
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
			throw commandFailed();
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
			throw commandFailed();
		}
	} else {
		console.error(`Unknown desktop command: ${action}`);
		console.error("Available: start");
		throw commandFailed();
	}
}

// ── Workflow & Harness Action Handlers (Section 29) ─────────────────────

async function handleWorkflow(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const { createBrowserControl } = await import("./browser_control");
	const bc = createBrowserControl();
	const parseStateValue = (rawValue: string): string | number | boolean => {
		const trimmed = rawValue.trim();
		if (trimmed === "true") return true;
		if (trimmed === "false") return false;
		if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
		return rawValue;
	};

	try {
		switch (subcommand) {
			case "run": {
				const graphPathOrName = positional[0];
				if (!graphPathOrName) {
					console.error("Error: graphPathOrName is required");
					throw commandFailed();
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
					throw commandFailed();
				}
				const result = await bc.workflow.run(graphJson);
				outputJson(result, !jsonOutput);
				break;
			}
			case "status": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					throw commandFailed();
				}
				const result = await bc.workflow.status(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "events": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					throw commandFailed();
				}
				const result = await bc.workflow.events(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "edit-state": {
				const runId = positional[0];
				const key = positional[1];
				const rawValue = positional[2];
				if (!runId || !key || rawValue === undefined) {
					console.error("Error: runId, key, and value are required");
					throw commandFailed();
				}
				const result = await bc.workflow.editState(
					runId,
					key,
					parseStateValue(rawValue),
				);
				outputJson(result, !jsonOutput);
				break;
			}
			case "resume": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					throw commandFailed();
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
					throw commandFailed();
				}
				const result = await bc.workflow.approve(runId, nodeId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "cancel": {
				const runId = positional[0];
				if (!runId) {
					console.error("Error: runId is required");
					throw commandFailed();
				}
				const result = await bc.workflow.cancel(runId);
				outputJson(result, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown workflow command: ${subcommand}`);
				console.error(
					"Available: run, status, events, edit-state, resume, approve, cancel",
				);
				throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				const result = await bc.harness.rollback(helperId, version);
				outputJson(result, !jsonOutput);
				break;
			}
			case "generate": {
				const id = flags.id ?? positional[0];
				const purpose = flags.purpose ?? positional[1];
				if (!id || !purpose) {
					console.error("Error: --id and --purpose are required");
					throw commandFailed();
				}
				const filesFlag = flags.files;
				const files = filesFlag
					? filesFlag.split("\0").map((f) => {
						const [path, ...rest] = f.split(":");
						return { path: path ?? "", content: rest.join(":") || "" };
					})
					: [{ path: "helper.js", content: "" }];
				const result = await bc.harness.generate({
					id,
					purpose,
					files,
					taskTags: flags["task-tags"]?.split(","),
					failureTypes: flags["failure-types"]?.split(","),
					site: flags.site,
					domains: flags.domains?.split(","),
					usage: flags.usage,
					version: flags.version,
					testCommand: flags["test-command"],
					activate: flags.activate === "true",
				});
				outputJson(result, !jsonOutput);
				break;
			}
			case "execute": {
				const helperId = positional[0];
				if (!helperId) {
					console.error("Error: helperId is required");
					throw commandFailed();
				}
				let input: Record<string, unknown> = {};
				if (flags.input) {
					try {
						input = JSON.parse(flags.input);
					} catch {
						console.error("Error: Invalid JSON in --input");
						throw commandFailed();
					}
				}
				const result = await bc.harness.execute(helperId, input);
				outputJson(result, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown harness command: ${subcommand}`);
				console.error("Available: list, validate, rollback, generate, execute");
				throw commandFailed();
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
			case "record": {
				const recordAction = positional[0];
				const {
					recordPackageRecordingAction,
					startPackageRecording,
					stopPackageRecording,
				} = await import("./packages/record_cli");
				if (recordAction === "start") {
					const name = flags.name ?? positional[1];
					if (!name) {
						console.error("Error: package recording name is required");
						throw commandFailed();
					}
					const session = startPackageRecording({
						name,
						domain: flags.domain,
					});
					outputJson({ success: true, data: session }, !jsonOutput);
					break;
				}
				if (recordAction === "action") {
					const kind = positional[1];
					if (!kind) {
						console.error("Error: recorded action kind is required");
						throw commandFailed();
					}
					const params =
						flags.params === undefined
							? {}
							: JSON.parse(flags.params) as Record<string, unknown>;
					const action = recordPackageRecordingAction({
						kind: kind as import("./observability/recorder").RecordedActionKind,
						params,
					});
					outputJson({ success: true, data: action }, !jsonOutput);
					break;
				}
				if (recordAction === "stop") {
					const session = stopPackageRecording();
					outputJson({ success: true, data: session }, !jsonOutput);
					break;
				}
				console.error(
					"Error: Use 'package record start', 'package record action', or 'package record stop'",
				);
				throw commandFailed();
			}
			case "draft": {
				const recordingId = positional[0];
				if (!recordingId) {
					console.error("Error: recording id is required");
					throw commandFailed();
				}
				const { draftPackageRecording } = await import("./packages/record_cli");
				outputJson(
					{ success: true, data: draftPackageRecording(recordingId) },
					!jsonOutput,
				);
				break;
			}
			case "materialize": {
				const recordingId = positional[0];
				if (!recordingId) {
					console.error("Error: recording id is required");
					throw commandFailed();
				}
				const { materializePackageRecording } = await import(
					"./packages/record_cli"
				);
				const materialized = materializePackageRecording(recordingId, {
					overwrite: flags.overwrite === "true",
				});
				const installedPackage =
					flags.install === "true"
						? await bc.package.install(materialized.packageDir)
						: undefined;
				outputJson(
					{
						success: installedPackage ? installedPackage.success : true,
						data: {
							...materialized,
							...(installedPackage ? { installedPackage } : {}),
						},
						...(installedPackage?.error ? { error: installedPackage.error } : {}),
					},
					!jsonOutput,
				);
				break;
			}
			case "install": {
				const source = positional[0];
				if (!source) {
					console.error("Error: package source path is required");
					throw commandFailed();
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
					throw commandFailed();
				}
				const result = await bc.package.info(name);
				outputJson(result, !jsonOutput);
				break;
			}
			case "remove": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				const result = await bc.package.run(name, workflowNameOrId);
				outputJson(result, !jsonOutput);
				break;
			}
			case "eval": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					throw commandFailed();
				}
				const result = await bc.package.eval(name);
				outputJson(result, !jsonOutput);
				break;
			}
			case "review": {
				const name = positional[0];
				const status = positional[1] as
					| "unreviewed"
					| "pending"
					| "approved"
					| "rejected"
					| undefined;
				if (
					!name ||
					!status ||
					!["unreviewed", "pending", "approved", "rejected"].includes(status)
				) {
					console.error(
						"Error: package name and review status are required",
					);
					throw commandFailed();
				}
				const result = bc.package.review(
					name,
					status,
					flags.by ?? "cli-user",
					flags.reason,
				);
				outputJson(result, !jsonOutput);
				break;
			}
			case "review-history": {
				const name = positional[0];
				if (!name) {
					console.error("Error: package name is required");
					throw commandFailed();
				}
				const result = bc.package.reviewHistory(name);
				outputJson(result, !jsonOutput);
				break;
			}
			case "eval-history": {
				const result = bc.package.evalHistory(positional[0]);
				outputJson(result, !jsonOutput);
				break;
			}
			case "sign": {
				const source = positional[0];
				if (!source) {
					console.error("Error: package source path is required");
					throw commandFailed();
				}
				const { computePackageDigest } = await import("./packages/manifest");
				const digestResult = computePackageDigest(source);
				let signature: string | undefined;
				if (flags["private-key"]) {
					const crypto = await import("node:crypto");
					const privateKeyPem = fs.readFileSync(flags["private-key"], "utf8");
					const signer = crypto.createSign("SHA256");
					signer.update(digestResult.digest);
					signer.end();
					signature = signer.sign(privateKeyPem, "base64");
				}
				outputJson(
					{
						success: true,
						data: {
							signer: flags.signer,
							digest: digestResult.digest,
							signature,
							files: digestResult.files,
							fileCount: digestResult.fileCount,
							totalBytes: digestResult.totalBytes,
						},
					},
					!jsonOutput,
				);
				break;
			}
			default:
				console.error(`Unknown package command: ${subcommand}`);
				console.error(
					"Available: record, draft, materialize, install, list, info, remove, update, grant, run, eval, review, review-history, eval-history, sign",
				);
				throw commandFailed();
		}
	} finally {
		bc.close();
	}
}

async function handleVault(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	const action = subcommand || "list";
	const { CredentialVault } = await import("./security/credential_vault");
	const vault = new CredentialVault();

	try {
		switch (action) {
			case "list": {
				outputJson(await vault.list(), !jsonOutput);
				break;
			}
			case "set": {
				const scope = flags.scope;
				const scopeName = flags["scope-name"] ?? positional[0];
				const secretName = flags["secret-name"] ?? positional[1];
				const value = flags.value ?? positional[2];
				if (
					scope !== "site" &&
					scope !== "package" &&
					scope !== "workflow"
				) {
					console.error("Error: --scope must be site, package, or workflow");
					throw commandFailed();
				}
				if (!scopeName || !secretName || !value) {
					console.error(
						"Error: scope name, secret name, and value are required",
					);
					throw commandFailed();
				}
				if (flags.confirm !== "STORE_SECRET") {
					console.error(
						"Error: storing a secret requires --confirm=STORE_SECRET",
					);
					throw commandFailed();
				}
				const stored = await vault.set(scope, scopeName, secretName, value);
				outputJson(
					{
						id: stored.id,
						scope: stored.scope,
						scopeName: stored.scopeName,
						secretName: stored.secretName,
						createdAt: stored.createdAt,
						updatedAt: stored.updatedAt,
						hasValue: true,
					},
					!jsonOutput,
				);
				break;
			}
			case "delete": {
				const secretId = flags["secret-id"] ?? positional[0];
				if (!secretId) {
					console.error("Error: secret id is required");
					throw commandFailed();
				}
				if (flags.confirm !== "DELETE_SECRET") {
					console.error(
						"Error: deleting a secret requires --confirm=DELETE_SECRET",
					);
					throw commandFailed();
				}
				await vault.delete(secretId);
				outputJson({ success: true, id: secretId }, !jsonOutput);
				break;
			}
			case "grants": {
				const grantAction = positional[0] ?? "list";
				if (grantAction === "list") {
					outputJson(await vault.listGrants(flags["secret-id"]), !jsonOutput);
					break;
				}
				if (grantAction === "add") {
					const secretId = flags["secret-id"] ?? positional[1];
					const actions = (flags.actions ?? flags.action ?? positional[2] ?? "")
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean);
					if (!secretId || actions.length === 0) {
						console.error("Error: secret id and action(s) are required");
						throw commandFailed();
					}
					if (flags.confirm !== "GRANT_SECRET") {
						console.error(
							"Error: granting secret use requires --confirm=GRANT_SECRET",
						);
						throw commandFailed();
					}
					const grant = await vault.grant(secretId, {
						actions: actions as never,
						siteScope: flags["site-scope"],
						domainScope: flags["domain-scope"] ?? flags.domain,
						packageScope: flags["package-scope"],
						workflowScope: flags["workflow-scope"],
						domain: flags.domain,
						expiresAt: flags["expires-at"],
					});
					outputJson(grant, !jsonOutput);
					break;
				}
				if (grantAction === "revoke") {
					const grantId = positional[1];
					if (!grantId) {
						console.error("Error: grant id is required");
						throw commandFailed();
					}
					await vault.revokeGrant(grantId);
					outputJson({ success: true, id: grantId }, !jsonOutput);
					break;
				}
				console.error(`Unknown vault grants command: ${grantAction}`);
				console.error("Available: list, add, revoke");
				throw commandFailed();
				break;
			}
			default:
				console.error(`Unknown vault command: ${action}`);
				console.error("Available: list, set, delete, grants");
				throw commandFailed();
		}
	} finally {
		vault.close();
	}
}

async function handleNetwork(args: ParsedArgs): Promise<void> {
	const { subcommand, positional, flags } = args;
	const jsonOutput = flags.json === "true";
	if (subcommand !== "rules") {
		console.error(`Unknown network command: ${subcommand}`);
		console.error("Available: rules");
		throw commandFailed();
	}
	const rulesAction = positional[0] ?? "list";
	const { NetworkRuleEngine } = await import("./security/network_rules");
	const engine = new NetworkRuleEngine();

	try {
		switch (rulesAction) {
			case "list": {
				outputJson(await engine.listRules(), !jsonOutput);
				break;
			}
			case "add": {
				const pattern = flags.pattern ?? positional[1];
				const ruleType = flags["rule-type"] ?? flags.type ?? positional[2];
				if (!pattern) {
					console.error("Error: rule pattern is required");
					throw commandFailed();
				}
				if (
					ruleType !== "allowlist" &&
					ruleType !== "denylist" &&
					ruleType !== "tracker"
				) {
					console.error(
						"Error: rule type must be allowlist, denylist, or tracker",
					);
					throw commandFailed();
				}
				const resourceTypes = flags["resource-types"]
					? flags["resource-types"].split(",").map((item) => item.trim())
					: undefined;
				outputJson(
					await engine.addRule(pattern, ruleType, resourceTypes as never),
					!jsonOutput,
				);
				break;
			}
			case "remove": {
				const id = positional[1];
				if (!id) {
					console.error("Error: rule id is required");
					throw commandFailed();
				}
				outputJson({ removed: await engine.removeRule(id) }, !jsonOutput);
				break;
			}
			default:
				console.error(`Unknown network rules command: ${rulesAction}`);
				console.error("Available: list, add, remove");
				throw commandFailed();
		}
	} finally {
		engine.close();
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
		const tabId = flags.tab ?? flags["tab-id"] ?? flags.tabId;
		const continueOnFailure =
			flags["continue-on-failure"] === "true" ||
			flags.continueOnFailure === "true";

		switch (action) {
			case "open": {
				const url = positional[0];
				if (!url) {
					console.error("Error: URL is required");
					throw commandFailed();
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
					tabId,
				});
				break;
			}

			case "click": {
				const target = positional[0];
				if (!target) {
					console.error("Error: Target (ref, selector, or text) is required");
					throw commandFailed();
				}
				result = await browserActions.click({
					target,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					force: flags.force === "true",
					tabId,
				});
				break;
			}

			case "fill": {
				const target = positional[0];
				const text = positional[1];
				if (!target || !text) {
					console.error("Error: Target and text are required");
					throw commandFailed();
				}
				result = await browserActions.fill({
					target,
					text,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					commit: flags.commit === "true",
					tabId,
				});
				break;
			}

			case "fill-many": {
				const fieldsStr = flags.fields ?? positional[0];
				if (!fieldsStr) {
					console.error("Error: Fields JSON array is required (e.g. '[{\"target\":\"@e3\", \"text\":\"hello\"}]')");
					throw commandFailed();
				}
				let fields: any[];
				try {
					fields = JSON.parse(fieldsStr);
				} catch {
					console.error("Error: Invalid JSON for fields");
					throw commandFailed();
				}
				result = await browserActions.fillMany(fields, {
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					continueOnFailure,
					tabId,
				});
				break;
			}

			case "hover": {
				const target = positional[0];
				if (!target) {
					console.error("Error: Target is required");
					throw commandFailed();
				}
				result = await browserActions.hover({
					target,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					tabId,
				});
				break;
			}

			case "type": {
				const text = positional[0];
				if (!text) {
					console.error("Error: Text is required");
					throw commandFailed();
				}
				result = await browserActions.type({
					text,
					delayMs: flags.delay ? Number(flags.delay) : undefined,
					tabId,
				});
				break;
			}

			case "paste": {
				const text = positional[0];
				if (!text) {
					console.error("Error: Text is required");
					throw commandFailed();
				}
				result = await browserActions.paste({
					text,
					target: flags.target,
					timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
					tabId,
				});
				break;
			}

			case "press": {
				const key = positional[0];
				if (!key) {
					console.error("Error: Key is required (e.g., Enter, Tab, ArrowDown)");
					throw commandFailed();
				}
				result = await browserActions.press({ key, tabId });
				break;
			}

			case "scroll": {
				const direction = positional[0] ?? "down";
				if (!["up", "down", "left", "right"].includes(direction)) {
					console.error("Error: Direction must be up, down, left, or right");
					throw commandFailed();
				}
				result = await browserActions.scroll({
					direction: direction as "up" | "down" | "left" | "right",
					amount: flags.amount ? Number(flags.amount) : undefined,
					tabId,
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
					tabId,
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
						throw commandFailed();
					}
					result = await browserActions.tabSwitch(tabId);
				} else {
					console.error(
						"Error: Unknown tab command. Use 'tab list' or 'tab switch <id>'",
					);
					throw commandFailed();
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
					throw commandFailed();
				}
				break;
			}

			default:
				console.error(`Unknown browser action: ${action}`);
				throw commandFailed();
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
					throw commandFailed();
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
	}
}

// ── Locator Handler (Section 25) ────────────────────────────────────────

async function handleLocator(args: ParsedArgs): Promise<void> {
	const { positional, flags } = args;
	const jsonOutput = flags.json === "true";

	const target = positional[0];
	if (!target) {
		console.error("Error: Target (ref, selector, or text) is required");
		throw commandFailed();
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
				throw commandFailed();
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
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
				throw commandFailed();
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
					throw commandFailed();
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
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
					throw commandFailed();
				}
				result = await serviceActions.resolve({ name });
				break;
			}

			case "remove": {
				const name = positional[0];
				if (!name) {
					console.error("Error: Service name is required");
					throw commandFailed();
				}
				result = serviceActions.remove({ name });
				break;
			}

			case "proxy": {
				const proxyAction = positional[0] || "status";
				const { createBrowserControl } = await import("./browser_control");
				const { getRuntimeDir } = await import("./shared/paths");
				const bc = createBrowserControl();
				const statusPath = path.join(getRuntimeDir(), "localhost-proxy.json");
				const readProxyStatus = (): Record<string, unknown> | null => {
					if (!fs.existsSync(statusPath)) return null;
					try {
						return JSON.parse(fs.readFileSync(statusPath, "utf8"));
					} catch {
						return null;
					}
				};
				const isPidAlive = (pid: unknown): pid is number => {
					if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
					try {
						process.kill(Number(pid), 0);
						return true;
					} catch {
						return false;
					}
				};
				const writeProxyStatus = (data: Record<string, unknown>) => {
					fs.mkdirSync(path.dirname(statusPath), { recursive: true });
					fs.writeFileSync(statusPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
				};
				try {
					switch (proxyAction) {
						case "status": {
							const saved = readProxyStatus();
							if (saved && isPidAlive(saved.pid)) {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: {
										enabled: true,
										background: true,
										pid: saved.pid,
										host: saved.host,
										port: saved.port,
										url: saved.url,
										httpsEnabled: false,
										allowRemote: saved.allowRemote === true,
										activeConnections: 0,
									},
									completedAt: new Date().toISOString(),
								};
								break;
							}
							result = bc.service.proxy.status();
							break;
						}
						case "start": {
							const rawPort = flags.port ? Number(flags.port) : 80;
							if (Number.isNaN(rawPort) || rawPort < 0 || rawPort > 65535) {
								console.error("Error: --port must be a valid TCP port");
								throw commandFailed();
							}
							if (flags.background === "true") {
								if (flags.https === "true") {
									console.error("Error: background HTTPS .localhost proxy is not supported; start it in the foreground so certificate/key errors are visible.");
									throw commandFailed();
								}
								const saved = readProxyStatus();
								if (saved && isPidAlive(saved.pid)) {
									result = {
										success: true,
										path: "command",
										sessionId: "system",
										data: saved,
										completedAt: new Date().toISOString(),
									};
									break;
								}
								const { spawn } = await import("node:child_process");
								const cliEntry = fs.existsSync(path.join(process.cwd(), "src", "cli.ts"))
									? path.join(process.cwd(), "src", "cli.ts")
									: process.argv[1];
								const nodeArgs = cliEntry.endsWith(".ts")
									? ["--require", "ts-node/register", "--require", "tsconfig-paths/register"]
									: [];
								const childArgs = [
									...nodeArgs,
									cliEntry,
									"service",
									"proxy",
									"start",
									"--json",
									"--port",
									String(rawPort),
									...(flags["allow-remote"] === "true"
										? ["--allow-remote", "true"]
										: []),
									"--status-file",
									statusPath,
								].filter((value): value is string => Boolean(value));
								const child = spawn(process.execPath, childArgs, {
									cwd: process.cwd(),
									env: process.env,
									detached: true,
									stdio: "ignore",
									windowsHide: true,
								});
								child.unref();
								const deadline = Date.now() + 10_000;
								let started: Record<string, unknown> | null = null;
								while (Date.now() < deadline) {
									await new Promise((resolve) => setTimeout(resolve, 100));
									const candidate = readProxyStatus();
									if (candidate && isPidAlive(candidate.pid)) {
										started = candidate;
										break;
									}
								}
								if (!started) {
									console.error("Error: background .localhost proxy did not report ready status");
									throw commandFailed();
								}
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: started,
									completedAt: new Date().toISOString(),
								};
								break;
							}
							const started = await bc.service.proxy.start({
								port: rawPort,
								allowRemote: flags["allow-remote"] === "true",
								https: flags.https === "true",
								certPath: flags.cert,
								keyPath: flags.key,
								localCa: flags["local-ca"] === "true",
								caDir: flags["ca-dir"],
							});
							if (started.success && flags["status-file"]) {
								writeProxyStatus({
									...((started.data ?? {}) as unknown as Record<string, unknown>),
									pid: process.pid,
									background: true,
									startedAt: new Date().toISOString(),
									allowRemote: flags["allow-remote"] === "true",
								});
							}
							if (jsonOutput) outputJson(formatActionResult(started), false);
							else if (started.success) {
								const data = started.data as { url?: string };
								console.log(`.localhost proxy: ${data.url || "started"}`);
								console.log("Press Ctrl+C to stop.");
							} else {
								console.error(`Error: ${started.error}`);
								throw commandFailed();
							}
							if (flags.wait === "false") {
								await bc.service.proxy.stop();
								return;
							}
							const stopAndExit = async () => {
								await bc.service.proxy.stop().catch(() => undefined);
								if (flags["status-file"]) {
									fs.rmSync(String(flags["status-file"]), { force: true });
								}
								bc.close();
								exitImmediately(0);
							};
							process.once("SIGINT", () => {
								void stopAndExit();
							});
							process.once("SIGTERM", () => {
								void stopAndExit();
							});
							await new Promise<void>(() => undefined);
							return;
						}
						case "stop": {
							const saved = readProxyStatus();
							if (saved && isPidAlive(saved.pid)) {
								process.kill(Number(saved.pid), "SIGTERM");
								let deadline = Date.now() + 1_000;
								while (Date.now() < deadline && isPidAlive(saved.pid)) {
									await new Promise((resolve) => setTimeout(resolve, 100));
								}
								if (isPidAlive(saved.pid)) {
									process.kill(Number(saved.pid), "SIGKILL");
									deadline = Date.now() + 3_000;
									while (Date.now() < deadline && isPidAlive(saved.pid)) {
										await new Promise((resolve) => setTimeout(resolve, 100));
									}
								}
								fs.rmSync(statusPath, { force: true });
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: { stopped: true, pid: saved.pid },
									completedAt: new Date().toISOString(),
								};
								break;
							}
							result = await bc.service.proxy.stop();
							break;
						}
						case "startup": {
							const startupAction = positional[1] || "status";
							const {
								getLocalhostProxyStartupStatus,
								installLocalhostProxyStartup,
								uninstallLocalhostProxyStartup,
							} = await import("./services/startup");
							const startupOptions = {
								startupDir: flags["startup-dir"],
								command: flags.command,
								port: flags.port ? Number(flags.port) : 80,
								allowRemote: flags["allow-remote"] === "true",
							};
							if (Number.isNaN(startupOptions.port) || startupOptions.port < 0 || startupOptions.port > 65535) {
								console.error("Error: --port must be a valid TCP port");
								throw commandFailed();
							}
							if (startupAction === "status") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: getLocalhostProxyStartupStatus(startupOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							await requireCliPolicy(
								"service_proxy_start",
								{ startup: true, action: startupAction, port: startupOptions.port },
								jsonOutput,
								flags.yes === "true",
							);
							if (startupAction === "install") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: installLocalhostProxyStartup(startupOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							if (startupAction === "uninstall") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: uninstallLocalhostProxyStartup(startupOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							console.error(`Unknown service proxy startup command: ${startupAction}`);
							console.error("Available: status, install, uninstall");
							throw commandFailed();
						}
						case "ca": {
							const caAction = positional[1] || "status";
							const {
								createLocalhostCa,
								getLocalhostCaStatus,
								installLocalhostCaTrust,
								uninstallLocalhostCaTrust,
							} = await import("./services/local_ca");
							const caOptions = { caDir: flags["ca-dir"] };
							if (caAction === "status") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: getLocalhostCaStatus(caOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							await requireCliPolicy(
								"service_proxy_start",
								{ localCa: true, action: caAction, caDir: flags["ca-dir"] },
								jsonOutput,
								flags.yes === "true",
							);
							if (caAction === "create") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: createLocalhostCa({
										...caOptions,
										rotate: flags.rotate === "true",
										days: flags.days ? Number(flags.days) : undefined,
									}),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							if (caAction === "install") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: installLocalhostCaTrust(caOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							if (caAction === "uninstall") {
								result = {
									success: true,
									path: "command",
									sessionId: "system",
									data: uninstallLocalhostCaTrust(caOptions),
									completedAt: new Date().toISOString(),
								};
								break;
							}
							console.error(`Unknown service proxy ca command: ${caAction}`);
							console.error("Available: status, create, install, uninstall");
							throw commandFailed();
						}
						default:
							console.error(`Unknown service proxy command: ${proxyAction}`);
							console.error("Available: status, start, stop, startup, ca");
							throw commandFailed();
					}
				} finally {
					if (proxyAction !== "start") bc.close();
				}
				break;
			}

			default:
				console.error(`Unknown service command: ${subcommand}`);
				console.error("Available: register, list, resolve, remove, proxy");
				throw commandFailed();
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
					throw commandFailed();
				}
			}
		}
	} catch (error) {
		console.error("Error:", (error as Error).message);
		throw commandFailed();
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
				throw commandFailed();
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
					throw commandFailed();
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
				throw commandFailed();
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
				throw commandFailed();
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
				throw commandFailed();
			}
			break;
		}

		case "receipt": {
			const receiptId = positional[0];
			if (!receiptId) {
				console.error("Error: Receipt ID is required");
				throw commandFailed();
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
					throw commandFailed();
				}
				outputJson(receipt, !jsonOutput);
			} catch (error) {
				console.error("Error:", (error as Error).message);
				throw commandFailed();
			}
			break;
		}

		default:
			console.error(`Unknown debug command: ${subcommand}`);
			console.error(
				"Available: bundle <id>, console [--session=<id>], network [--session=<id>], receipt <id>",
			);
			throw commandFailed();
	}
}

if (require.main === module) {
	installGlobalFatalHandlers({ component: "cli" });
	runCli().catch((error) => {
		if (error instanceof CliError) {
			if (!error.reported) console.error(error.message);
			process.exitCode = error.exitCode;
		} else {
			console.error("Fatal error:", error.message);
			process.exitCode = 1;
		}
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
