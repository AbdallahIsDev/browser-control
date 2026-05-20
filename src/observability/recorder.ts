import crypto from "node:crypto";
import { logger } from "../shared/logger";
import { redactSecretRefs } from "../security/credential_vault";
import type { ReplayDebugView } from "./visual_diff";
import { redactObject, redactString } from "./redaction";
import type { ActionResult } from "../shared/action_result";
import type { KnowledgeEntry } from "../knowledge/types";

const log = logger.withComponent("recorder");

// ── Types ───────────────────────────────────────────────────────────

export type RecordedActionKind = "browser-open" | "browser-click" | "browser-fill" | "browser-snapshot" | "browser-screenshot" | "browser-press" | "browser-dialog" | "browser-cdp" | "terminal-exec" | "terminal-type" | "fs-read" | "fs-write" | "approval";

export interface RecordedAction {
	id: string;
	kind: RecordedActionKind;
	timestamp: string;
	params: Record<string, unknown>;
	result?: unknown;
	error?: string;
	policyDecision?: string;
	sessionId?: string;
}

export interface RecordingSession {
	id: string;
	startedAt: string;
	name: string;
	actions: RecordedAction[];
	domain?: string;
	sessionId?: string;
}

export interface WorkflowDraft {
	id: string;
	name: string;
	version: string;
	nodes: Array<{ id: string; kind: string; name?: string; input: Record<string, unknown> }>;
	edges: Array<{ from: string; to: string }>;
	entryNodeId: string;
}

export interface PackageDraft {
	manifest: {
		schemaVersion: "1";
		name: string;
		version: string;
		description: string;
		browserControlVersion: string;
		permissions: Array<{
			kind: string;
			domains?: string[];
			commands?: string[];
			paths?: string[];
			access?: "read" | "write" | "read-write";
		}>;
		workflows: string[];
		evals: string[];
	};
	workflow: WorkflowDraft;
	evalDefinition: { id: string; name: string; workflow: string; expectedStatus: "completed" | "failed"; };
}

// ── Recorder ────────────────────────────────────────────────────────

export class ActionRecorder {
	private sessions = new Map<string, RecordingSession>();
	private activeId: string | null = null;

	start(name: string, domain?: string): RecordingSession {
		const id = `rec-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
		const session: RecordingSession = {
			id, startedAt: new Date().toISOString(), name, actions: [], domain,
		};
		this.sessions.set(id, session);
		this.activeId = id;
		return session;
	}

	stop(): RecordingSession | null {
		if (!this.activeId) return null;
		const session = this.sessions.get(this.activeId) ?? null;
		this.activeId = null;
		return session;
	}

	isActive(): boolean {
		return Boolean(this.activeId);
	}

	record(kind: RecordedActionKind, params: Record<string, unknown>, result?: ActionResult): RecordedAction {
		if (!this.activeId) throw new Error("No active recording session");
		const session = this.sessions.get(this.activeId)!;
		const redactedParams = redactRecordedValue(params) as Record<string, unknown>;
		const action: RecordedAction = {
			id: `act-${session.actions.length + 1}`,
			kind,
			timestamp: new Date().toISOString(),
			params: redactedParams,
			result: result?.data,
			error: result?.error ? redactSecretRefs(redactString(result.error)) : undefined,
			policyDecision: result?.policyDecision,
			sessionId: session.sessionId,
		};
		session.actions.push(action);
		return action;
	}

	getSession(id: string): RecordingSession | null {
		return this.sessions.get(id) ?? null;
	}

	listSessions(): RecordingSession[] {
		return [...this.sessions.values()].sort((a, b) =>
			b.startedAt.localeCompare(a.startedAt),
		);
	}
}

export function recordIfActive(
	kind: RecordedActionKind,
	params: Record<string, unknown>,
	result?: ActionResult,
): RecordedAction | null {
	const recorder = getRecorder();
	if (!recorder.isActive()) return null;
	try {
		return recorder.record(kind, params, result);
	} catch (error) {
		log.warn(
			`Replay recorder skipped action ${kind}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

function redactRecordedValue(value: unknown): unknown {
	const redacted = redactObject(value);
	if (typeof redacted === "string") return redactSecretRefs(redacted);
	if (Array.isArray(redacted)) return redacted.map(redactRecordedValue);
	if (typeof redacted === "object" && redacted !== null) {
		return Object.fromEntries(
			Object.entries(redacted).map(([key, item]) => [
				key,
				redactRecordedValue(item),
			]),
		);
	}
	return redacted;
}

// ── Replay Converter ───────────────────────────────────────────────

function kindToNodeType(kind: RecordedActionKind): { nodeKind: string; nodeInput: Record<string, unknown> } {
	switch (kind) {
		case "browser-open": return { nodeKind: "browser", nodeInput: { action: "open", url: "" } };
		case "browser-click": return { nodeKind: "browser", nodeInput: { action: "click", target: "" } };
		case "browser-fill": return { nodeKind: "browser", nodeInput: { action: "fill", target: "", text: "" } };
		case "browser-snapshot": return { nodeKind: "browser", nodeInput: { action: "snapshot" } };
		case "browser-screenshot": return { nodeKind: "browser", nodeInput: { action: "screenshot" } };
		case "browser-press": return { nodeKind: "browser", nodeInput: { action: "press", key: "" } };
		case "browser-dialog": return { nodeKind: "browser", nodeInput: { action: "dialog", dialogAction: "" } };
		case "terminal-exec": return { nodeKind: "terminal", nodeInput: { command: "" } };
		case "terminal-type": return { nodeKind: "terminal", nodeInput: { command: "" } };
		case "fs-read": return { nodeKind: "filesystem", nodeInput: { action: "read", path: "" } };
		case "fs-write": return { nodeKind: "filesystem", nodeInput: { action: "write", path: "", content: "" } };
		case "approval": return { nodeKind: "approval", nodeInput: {} };
		default: return { nodeKind: "wait", nodeInput: { durationMs: 1000 } };
	}
}

export function convertRecordingToWorkflow(session: RecordingSession): WorkflowDraft {
	const nodes = session.actions
		.map((action, i) => {
			const { nodeKind, nodeInput } = kindToNodeType(action.kind);
			const input: Record<string, unknown> = { ...nodeInput };
			for (const [k, v] of Object.entries(action.params)) {
				if (k !== "url" && k !== "target" && k !== "text" && k !== "command" && k !== "key" && k !== "path" && k !== "content") {
					// Re-map known params to node input
					if (nodeKind === "browser" && k === "target") input.target = v;
					if (nodeKind === "browser" && k === "url") input.url = v;
					if (nodeKind === "terminal" && k === "command") input.command = v;
				}
			}
			// Use params directly
			for (const [k, v] of Object.entries(action.params)) {
				if (["url", "target", "text", "command", "key", "path", "content"].includes(k)) {
					input[k] = v;
				}
			}
			return { id: `node-${i + 1}`, kind: nodeKind, name: action.kind, input: Object.keys(input).length > 0 ? input : nodeInput };
		});

	const edges = [];
	for (let i = 0; i < nodes.length - 1; i++) {
		edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
	}

	const entryNodeId = nodes[0]?.id ?? "node-1";
	const slug = session.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";

	return {
		id: `wf-${session.id}`,
		name: session.name,
		version: "1.0",
		nodes,
		edges,
		entryNodeId,
	};
}

export function convertRecordingToPackage(session: RecordingSession): PackageDraft {
	const workflow = convertRecordingToWorkflow(session);
	const slug = session.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "automation";
	const workflowPath = `workflows/${workflow.id}.json`;
	const evalPath = "evals/eval-basic.json";
	const browserDomains = uniqueStrings([
		session.domain,
		...session.actions
			.filter(action => action.kind.startsWith("browser-"))
			.map(action => domainFromRecordedUrl(action.params.url)),
	]);
	const terminalCommands = uniqueStrings(
		session.actions
			.filter(action => action.kind === "terminal-exec")
			.map(action => action.params.command),
	);
	const fsReadPaths = uniqueStrings(
		session.actions
			.filter(action => action.kind === "fs-read")
			.map(action => action.params.path),
	);
	const fsWritePaths = uniqueStrings(
		session.actions
			.filter(action => action.kind === "fs-write")
			.map(action => action.params.path),
	);
	const fsPaths = uniqueStrings([...fsReadPaths, ...fsWritePaths]);
	const fsAccess: "read" | "write" | "read-write" =
		fsReadPaths.length > 0 && fsWritePaths.length > 0
			? "read-write"
			: fsWritePaths.length > 0
				? "write"
				: "read";
	const permissions: PackageDraft["manifest"]["permissions"] = [];
	if (session.actions.some(action => action.kind.startsWith("browser-"))) {
		permissions.push({ kind: "browser", domains: browserDomains });
	}
	if (terminalCommands.length > 0) {
		permissions.push({ kind: "terminal", commands: terminalCommands });
	}
	if (fsPaths.length > 0) {
		permissions.push({ kind: "filesystem", paths: fsPaths, access: fsAccess });
	}
	return {
		manifest: {
			schemaVersion: "1",
			name: slug,
			version: "1.0",
			description: `Recorded automation: ${session.name}`,
			browserControlVersion: "1.0.0",
			permissions,
			workflows: [workflowPath],
			evals: [evalPath],
		},
		workflow,
		evalDefinition: {
			id: "eval-basic",
			name: "Basic replay evaluation",
			workflow: workflow.id,
			expectedStatus: "completed",
		},
	};
}

export function convertRecordingToReplayView(session: RecordingSession): ReplayDebugView {
	const steps = session.actions.map((action, index) => ({
		index: index + 1,
		nodeId: action.id,
		kind: action.kind,
		input: redactRecordedValue(action.params) as Record<string, unknown>,
		output: redactRecordedValue(action.result),
		error: action.error ? redactSecretRefs(redactString(action.error)) : undefined,
		policyDecision: action.policyDecision,
		retryCount: 0,
		durationMs: 0,
		startedAt: action.timestamp,
	}));
	return {
		runId: session.id,
		status: "recorded",
		steps,
		totalDurationMs:
			session.actions.length > 0
				? new Date(session.actions.at(-1)?.timestamp ?? session.startedAt).getTime() -
					new Date(session.startedAt).getTime()
				: 0,
		startedAt: session.startedAt,
		completedAt: session.actions.at(-1)?.timestamp,
	};
}

function uniqueStrings(values: unknown[]): string[] {
	return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function domainFromRecordedUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		return new URL(value).hostname;
	} catch {
		return undefined;
	}
}

// ── Site Memory Upgrade ─────────────────────────────────────────────

export interface StaleLocatorScore {
	selector: string;
	role?: string;
	name?: string;
	staleProbability: number;
	lastUsedAt: string;
	successCount: number;
	failureCount: number;
}

export function scoreLocatorStaleness(entries: KnowledgeEntry[]): StaleLocatorScore[] {
	return entries
		.filter(e => e.type === "stable-selector" || e.type === "pitfall")
		.map(e => {
			const daysSinceVerified = e.lastVerified
				? (Date.now() - new Date(e.lastVerified).getTime()) / 86400000
				: 365;
			const staleProb = Math.min(1, daysSinceVerified / 30 + (e.verified ? 0 : 0.5));
			return {
				selector: e.selector ?? "unknown",
				role: e.role,
				name: e.name,
				staleProbability: Math.round(staleProb * 100) / 100,
				lastUsedAt: e.lastVerified,
				successCount: e.verified ? 1 : 0,
				failureCount: e.verified ? 0 : 1,
			};
		})
		.sort((a, b) => b.staleProbability - a.staleProbability);
}

// ── Singleton ───────────────────────────────────────────────────────

let _recorder: ActionRecorder | null = null;

export function getRecorder(): ActionRecorder {
	if (!_recorder) _recorder = new ActionRecorder();
	return _recorder;
}

export function resetRecorder(): void {
	_recorder = null;
}
