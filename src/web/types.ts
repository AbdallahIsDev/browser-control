import type { ActionResult } from "../shared/action_result";

export type WebEventKind =
	| "runtime.status"
	| "terminal.output"
	| "terminal.action"
	| "browser.action"
	| "filesystem.action"
	| "policy.decision"
	| "log.entry";

export interface WebAppEvent<T = unknown> {
	id: string;
	type: WebEventKind;
	timestamp: string;
	sessionId?: string;
	actionId?: string;
	payload: T;
}

export interface WebCapability {
	key: string;
	available: boolean;
	reason?: string;
}

export interface WebCapabilities {
	status: WebCapability;
	config: WebCapability;
	policy: WebCapability;
	browser: WebCapability;
	terminal: WebCapability;
	filesystem: WebCapability;
	tasks: WebCapability;
	automations: WebCapability;
	logs: WebCapability;
	debugEvidence: WebCapability;
	desktop: WebCapability;
}

export interface WebAppServerInfo {
	url: string;
	host: string;
	port: number;
	token: string;
}

export interface WebApiError {
	success: false;
	code:
		| "bad_request"
		| "unauthorized"
		| "forbidden"
		| "not_found"
		| "method_not_allowed"
		| "capability_unavailable"
		| "internal_error";
	error: string;
	actionResult?: ActionResult;
}

export interface TerminalExecBody {
	command?: unknown;
	sessionId?: unknown;
	timeoutMs?: unknown;
}

export interface TerminalSessionBody {
	shell?: unknown;
	cwd?: unknown;
	name?: unknown;
}

export interface BrowserOpenBody {
	url?: unknown;
	waitUntil?: unknown;
}

export interface BrowserTargetBody {
	target?: unknown;
	text?: unknown;
	key?: unknown;
	timeoutMs?: unknown;
	force?: unknown;
	commit?: unknown;
}

export interface FsPathBody {
	path?: unknown;
	content?: unknown;
	recursive?: unknown;
	force?: unknown;
	createDirs?: unknown;
}
