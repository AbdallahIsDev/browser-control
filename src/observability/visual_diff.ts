import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";
import { redactString } from "./redaction";
import { logger } from "../shared/logger";

const log = logger.withComponent("visual-diff");

// ── Types ───────────────────────────────────────────────────────────

export interface PixelDiffResult {
	beforePath?: string;
	afterPath?: string;
	diffPath?: string;
	changedPercent: number;
	totalPixels: number;
	differentPixels: number;
	timestamp: string;
}

export interface DomDiffNode {
	selector: string;
	role?: string;
	name?: string;
	text?: string;
	changed: boolean;
	oldText?: string;
	newText?: string;
	children: DomDiffNode[];
}

export interface DomDiffResult {
	timestamp: string;
	elementsAdded: number;
	elementsRemoved: number;
	elementsChanged: number;
	changedNodes: DomDiffNode[];
}

export interface ReplayStep {
	index: number;
	nodeId: string;
	kind: string;
	input: Record<string, unknown>;
	output?: unknown;
	error?: string;
	policyDecision?: string;
	retryCount: number;
	durationMs: number;
	startedAt: string;
	helperUsed?: string;
	screenshots?: { before?: string; after?: string };
}

export interface ReplayDebugView {
	runId: string;
	status: string;
	steps: ReplayStep[];
	totalDurationMs: number;
	startedAt: string;
	completedAt?: string;
}

export interface AuditFilter {
	sessionId?: string;
	workflowId?: string;
	packageName?: string;
	action?: string;
	risk?: string;
	limit?: number;
}

export interface AuditViewEntry {
	id: string;
	action: string;
	sessionId?: string;
	policyDecision?: string;
	risk?: string;
	details?: string;
	timestamp: string;
}

// ── Pixel Diff ──────────────────────────────────────────────────────

export function computePixelDiff(
	beforePath: string,
	afterPath: string,
): PixelDiffResult | null {
	try {
		const before = fs.readFileSync(beforePath);
		const after = fs.readFileSync(afterPath);
		const minLen = Math.min(before.length, after.length);
		let differentPixels = 0;
		for (let i = 0; i < minLen; i++) {
			if (before[i] !== after[i]) differentPixels++;
		}
		// Add size difference as changed pixels
		differentPixels += Math.abs(before.length - after.length);
		const totalPixels = Math.max(before.length, after.length);

		return {
			beforePath,
			afterPath,
			changedPercent: Math.round((differentPixels / totalPixels) * 10000) / 100,
			totalPixels,
			differentPixels,
			timestamp: new Date().toISOString(),
		};
	} catch (err) {
		log.error(`Pixel diff failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

// ── DOM Diff ────────────────────────────────────────────────────────

function compareText(oldText?: string, newText?: string): { changed: boolean; oldText?: string; newText?: string } {
	const safe = (t?: string) => t ? redactString(t) : undefined;
	const oldSafe = safe(oldText);
	const newSafe = safe(newText);
	if (oldSafe === newSafe) return { changed: false };
	return { changed: true, oldText: oldSafe, newText: newSafe };
}

export function computeDomDiff(
	beforeNodes: Array<{ selector: string; role?: string; name?: string; text?: string; children?: unknown[] }>,
	afterNodes: Array<{ selector: string; role?: string; name?: string; text?: string; children?: unknown[] }>,
): DomDiffResult {
	const beforeMap = new Map(beforeNodes.map(n => [n.selector, n]));
	const afterMap = new Map(afterNodes.map(n => [n.selector, n]));

	let added = 0;
	let removed = 0;
	const changed: DomDiffNode[] = [];

	for (const [sel, n] of afterMap) {
		if (!beforeMap.has(sel)) { added++; continue; }
		const old = beforeMap.get(sel)!;
		const textDiff = compareText(old.text, n.text);
		if (textDiff.changed) {
			changed.push({
				selector: sel,
				role: n.role,
				name: redactString(n.name ?? ""),
				changed: true,
				oldText: textDiff.oldText,
				newText: textDiff.newText,
				children: [],
			});
		}
	}

	for (const sel of beforeMap.keys()) {
		if (!afterMap.has(sel)) removed++;
	}

	return {
		timestamp: new Date().toISOString(),
		elementsAdded: added,
		elementsRemoved: removed,
		elementsChanged: changed.length,
		changedNodes: changed,
	};
}

// ── Replay Debugger ─────────────────────────────────────────────────

export function buildReplayView(
	run: {
		id: string;
		status: string;
		nodeResults: Record<string, Record<string, unknown>>;
		startedAt: string;
		completedAt?: string;
	},
): ReplayDebugView {
	const steps: ReplayStep[] = Object.entries(run.nodeResults ?? {}).map(([nodeId, result], i) => ({
		index: i + 1,
		nodeId,
		kind: (result.kind as string) ?? "unknown",
		input: (result.input as Record<string, unknown>) ?? {},
		output: result.output,
		error: result.error as string | undefined,
		policyDecision: result.policyDecision as string | undefined,
		retryCount: (result.retryCount as number) ?? 0,
		durationMs: result.completedAt && result.startedAt
			? new Date(result.completedAt as string).getTime() - new Date(result.startedAt as string).getTime()
			: 0,
		startedAt: (result.startedAt as string) ?? run.startedAt,
		helperUsed: (result.helperUsed as string) ?? undefined,
	}));

	return {
		runId: run.id,
		status: run.status,
		steps,
		totalDurationMs: run.completedAt
			? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
			: 0,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
	};
}

// ── Audit Viewer ────────────────────────────────────────────────────

export function filterAuditEntries(
	entries: AuditViewEntry[],
	filter: AuditFilter,
): AuditViewEntry[] {
	let result = entries;
	if (filter.sessionId) result = result.filter(e => e.sessionId === filter.sessionId);
	if (filter.action) result = result.filter(e => e.action === filter.action);
	if (filter.risk) result = result.filter(e => e.risk === filter.risk);
	result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	if (filter.limit) result = result.slice(0, filter.limit);
	return result;
}
