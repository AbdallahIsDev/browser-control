import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { ensureDataHome, getReportsDir } from "../shared/paths";
import { redactObject, redactString } from "./redaction";
import { logger } from "../shared/logger";

const log = logger.withComponent("visual-diff");

// ── Types ───────────────────────────────────────────────────────────

export interface PixelDiffResult {
	beforePath?: string;
	afterPath?: string;
	diffPath?: string;
	width?: number;
	height?: number;
	changedPixelCount?: number;
	changeRatio?: number;
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
		ensureDataHome();
		const before = PNG.sync.read(fs.readFileSync(beforePath));
		const after = PNG.sync.read(fs.readFileSync(afterPath));
		const width = Math.min(before.width, after.width);
		const height = Math.min(before.height, after.height);
		const diff = new PNG({ width, height });
		let changedPixelCount = 0;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (width * y + x) << 2;
				const beforeIdx = (before.width * y + x) << 2;
				const afterIdx = (after.width * y + x) << 2;
				const changed =
					before.data[beforeIdx] !== after.data[afterIdx] ||
					before.data[beforeIdx + 1] !== after.data[afterIdx + 1] ||
					before.data[beforeIdx + 2] !== after.data[afterIdx + 2] ||
					before.data[beforeIdx + 3] !== after.data[afterIdx + 3];
				if (changed) {
					changedPixelCount++;
					diff.data[idx] = 255;
					diff.data[idx + 1] = 0;
					diff.data[idx + 2] = 0;
					diff.data[idx + 3] = 255;
				} else {
					diff.data[idx] = after.data[afterIdx];
					diff.data[idx + 1] = after.data[afterIdx + 1];
					diff.data[idx + 2] = after.data[afterIdx + 2];
					diff.data[idx + 3] = 80;
				}
			}
		}

		const sizeDeltaPixels =
			Math.abs(before.width * before.height - after.width * after.height);
		const differentPixels = changedPixelCount + sizeDeltaPixels;
		const totalPixels = Math.max(before.width * before.height, after.width * after.height);
		const changeRatio = totalPixels === 0 ? 0 : differentPixels / totalPixels;
		const evidenceDir = path.join(getReportsDir(), "evidence", "visual-diff");
		fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
		const diffPath = path.join(
			evidenceDir,
			`diff-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`,
		);
		fs.writeFileSync(diffPath, PNG.sync.write(diff), { mode: 0o600 });

		return {
			beforePath,
			afterPath,
			diffPath,
			width,
			height,
			changedPixelCount,
			changeRatio,
			changedPercent: Math.round(changeRatio * 10000) / 100,
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

function redactDomText(value?: string): string | undefined {
	if (!value) return undefined;
	return redactString(value).replace(/secret:\/\/[^\s"'<>]+/giu, "[REDACTED]");
}

function redactEvidenceValue(value: unknown): unknown {
	const redacted = redactObject(value, 0);
	if (typeof redacted === "string") return redactDomText(redacted);
	if (Array.isArray(redacted)) return redacted.map(item => redactEvidenceValue(item));
	if (redacted && typeof redacted === "object" && Object.getPrototypeOf(redacted) === Object.prototype) {
		return Object.fromEntries(
			Object.entries(redacted as Record<string, unknown>).map(([key, item]) => [
				key,
				redactEvidenceValue(item),
			]),
		);
	}
	return redacted;
}

function compareText(oldText?: string, newText?: string): { changed: boolean; oldText?: string; newText?: string } {
	const safe = (t?: string) => redactDomText(t);
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
				name: redactDomText(n.name ?? ""),
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
		input: redactEvidenceValue((result.input as Record<string, unknown>) ?? {}) as Record<string, unknown>,
		output: redactEvidenceValue(result.output),
		error: result.error ? redactString(String(result.error)) : undefined,
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
	let result = entries.map(entry => ({
		...entry,
		details: entry.details ? redactString(entry.details) : undefined,
	}));
	if (filter.sessionId) result = result.filter(e => e.sessionId === filter.sessionId);
	if (filter.action) result = result.filter(e => e.action === filter.action);
	if (filter.risk) result = result.filter(e => e.risk === filter.risk);
	if (filter.workflowId) result = result.filter(e => e.details?.includes(filter.workflowId ?? ""));
	if (filter.packageName) result = result.filter(e => e.details?.includes(filter.packageName ?? ""));
	result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	if (filter.limit) result = result.slice(0, filter.limit);
	return result;
}
