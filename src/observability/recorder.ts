import crypto from "node:crypto";
import { logger } from "../shared/logger";
import { redactString } from "./redaction";
import type { ActionResult } from "../shared/action_result";
import type { KnowledgeEntry } from "../knowledge/types";

const log = logger.withComponent("recorder");

// ── Types ───────────────────────────────────────────────────────────

export type RecordedActionKind = "browser-open" | "browser-click" | "browser-fill" | "browser-snapshot" | "browser-screenshot" | "browser-press" | "terminal-exec" | "terminal-type" | "fs-read" | "fs-write" | "approval";

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
		permissions: Array<{ kind: string; domains?: string[]; commands?: string[] }>;
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

	record(kind: RecordedActionKind, params: Record<string, unknown>, result?: ActionResult): RecordedAction {
		if (!this.activeId) throw new Error("No active recording session");
		const session = this.sessions.get(this.activeId)!;
		const redactedParams: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(params)) {
			redactedParams[k] = typeof v === "string" ? redactString(v) : v;
		}
		const action: RecordedAction = {
			id: `act-${session.actions.length + 1}`,
			kind,
			timestamp: new Date().toISOString(),
			params: redactedParams,
			result: result?.data,
			error: result?.error ? redactString(result.error) : undefined,
			policyDecision: result?.policyDecision,
			sessionId: session.sessionId,
		};
		session.actions.push(action);
		return action;
	}

	getSession(id: string): RecordingSession | null {
		return this.sessions.get(id) ?? null;
	}
}

// ── Replay Converter ───────────────────────────────────────────────

function kindToNodeType(kind: RecordedActionKind): { nodeKind: string; nodeInput: Record<string, unknown> } {
	switch (kind) {
		case "browser-open": return { nodeKind: "browser", nodeInput: { url: "" } };
		case "browser-click": return { nodeKind: "browser", nodeInput: { target: "" } };
		case "browser-fill": return { nodeKind: "browser", nodeInput: { target: "", text: "" } };
		case "browser-snapshot": return { nodeKind: "wait", nodeInput: { durationMs: 500 } };
		case "browser-screenshot": return { nodeKind: "wait", nodeInput: { durationMs: 300 } };
		case "browser-press": return { nodeKind: "browser", nodeInput: { key: "" } };
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
		.filter(a => a.kind !== "browser-snapshot" && a.kind !== "browser-screenshot")
		.map((action, i) => {
			const { nodeKind, nodeInput } = kindToNodeType(action.kind);
			const input: Record<string, unknown> = {};
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
	return {
		manifest: {
			schemaVersion: "1",
			name: slug,
			version: "1.0",
			description: `Recorded automation: ${session.name}`,
			browserControlVersion: "1.0.0",
			permissions: [
				{ kind: "browser", domains: session.domain ? [session.domain] : [] },
				{ kind: "terminal", commands: [] },
				{ kind: "filesystem" },
			],
			workflows: [workflow.id],
			evals: ["eval-basic"],
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
