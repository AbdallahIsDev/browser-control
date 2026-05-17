/**
 * Terminal Render Models — Browser terminal view adapters.
 *
 * Converts native terminal session snapshots into semantic render state
 * for dashboard and agent accessibility consumption.
 */

import type { TerminalSnapshot } from "./types";

export interface TerminalRenderSegment {
	text: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
	foreground?: string;
	background?: string;
}

export interface TerminalRenderRow {
	index: number;
	text: string;
	segments: TerminalRenderSegment[];
}

export interface BrowserTerminalView {
	terminalSessionId: string;
	title: string;
	status: "running" | "idle" | "exited" | "failed";
	rows: TerminalRenderRow[];
	cursor?: { row: number; column: number; visible: boolean };
	canAcceptInput: boolean;
	lastActivityAt: string;
}

interface TerminalStyle {
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
	foreground?: string;
	background?: string;
}

interface MutableRow {
	segments: TerminalRenderSegment[];
}

const ANSI_COLORS: Record<number, string> = {
	30: "black",
	31: "red",
	32: "green",
	33: "yellow",
	34: "blue",
	35: "magenta",
	36: "cyan",
	37: "white",
	90: "bright-black",
	91: "bright-red",
	92: "bright-green",
	93: "bright-yellow",
	94: "bright-blue",
	95: "bright-magenta",
	96: "bright-cyan",
	97: "bright-white",
};

const DEFAULT_MAX_ROWS = 500;

/**
 * Builds a deterministic view of the terminal state suitable for browser rendering
 * or agent DOM inspection.
 */
export function buildTerminalView(
	snapshot: TerminalSnapshot,
	options: { maxRows?: number } = {},
): BrowserTerminalView {
	const rows = parseTerminalRows(snapshot.lastOutput, {
		maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
	});

	const statusMap: Record<
		TerminalSnapshot["status"],
		BrowserTerminalView["status"]
	> = {
		running: "running",
		idle: "idle",
		interrupted: "idle",
		closed: "exited",
	};

	const status = statusMap[snapshot.status] ?? "exited";
	const cursorRow = Math.max(0, rows.length - 1);
	const cursorColumn = rows[cursorRow]?.text.length ?? 0;

	return {
		terminalSessionId: snapshot.sessionId,
		title: snapshot.name || snapshot.runningCommand || snapshot.shell,
		status,
		rows,
		cursor: { row: cursorRow, column: cursorColumn, visible: status !== "exited" },
		canAcceptInput: snapshot.status === "idle" && snapshot.promptDetected === true,
		lastActivityAt: snapshot.lastActivityAt,
	};
}

export function parseTerminalRows(
	output: string,
	options: { maxRows?: number } = {},
): TerminalRenderRow[] {
	const rows: MutableRow[] = [{ segments: [] }];
	let currentStyle: TerminalStyle = {};

	const currentRow = () => rows[rows.length - 1] as MutableRow;
	const newline = () => rows.push({ segments: [] });
	const clearCurrentLine = () => {
		currentRow().segments = [];
	};

	for (let i = 0; i < output.length; i++) {
		const ch = output[i];
		if (ch === "\x1b") {
			const parsed = parseEscape(output, i);
			if (parsed) {
				i = parsed.endIndex;
				if (parsed.command === "m") {
					currentStyle = applySgr(currentStyle, parsed.args);
				} else if (parsed.command === "K") {
					clearCurrentLine();
				}
				continue;
			}
		}

		if (ch === "\n") {
			newline();
			continue;
		}
		if (ch === "\r") {
			clearCurrentLine();
			continue;
		}
		if (ch === "\b") {
			removeLastCharacter(currentRow());
			continue;
		}
		if (ch && ch >= " ") {
			appendText(currentRow(), ch, currentStyle);
		}
	}

	const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
	return rows
		.slice(-maxRows)
		.map((row, index) => toRenderRow(row, index));
}

function parseEscape(
	output: string,
	index: number,
): { command: string; args: number[]; endIndex: number } | null {
	if (output[index + 1] !== "[") {
		return null;
	}
	let cursor = index + 2;
	let rawArgs = "";
	while (cursor < output.length) {
		const ch = output[cursor] ?? "";
		if (/[A-Za-z]/u.test(ch)) {
			const args = rawArgs
				.split(";")
				.filter((part) => part !== "")
				.map((part) => Number.parseInt(part, 10))
				.filter((part) => Number.isFinite(part));
			return {
				command: ch,
				args: args.length > 0 ? args : [0],
				endIndex: cursor,
			};
		}
		rawArgs += ch;
		cursor += 1;
	}
	return null;
}

function applySgr(style: TerminalStyle, codes: number[]): TerminalStyle {
	let next: TerminalStyle = { ...style };
	for (const code of codes) {
		if (code === 0) next = {};
		else if (code === 1) next.bold = true;
		else if (code === 2) next.dim = true;
		else if (code === 4) next.underline = true;
		else if (code === 22) {
			delete next.bold;
			delete next.dim;
		} else if (code === 24) delete next.underline;
		else if (code === 39) delete next.foreground;
		else if (code === 49) delete next.background;
		else if (ANSI_COLORS[code]) next.foreground = ANSI_COLORS[code];
		else if (code >= 40 && code <= 47) next.background = ANSI_COLORS[code - 10];
		else if (code >= 100 && code <= 107)
			next.background = ANSI_COLORS[code - 10];
	}
	return next;
}

function appendText(row: MutableRow, text: string, style: TerminalStyle): void {
	const normalizedStyle = normalizeStyle(style);
	const last = row.segments[row.segments.length - 1];
	if (last && sameStyle(last, normalizedStyle)) {
		last.text += text;
		return;
	}
	row.segments.push({ text, ...normalizedStyle });
}

function removeLastCharacter(row: MutableRow): void {
	const last = row.segments[row.segments.length - 1];
	if (!last) return;
	last.text = last.text.slice(0, -1);
	if (!last.text) row.segments.pop();
}

function toRenderRow(row: MutableRow, index: number): TerminalRenderRow {
	const segments =
		row.segments.length > 0 ? row.segments : [{ text: "" } satisfies TerminalRenderSegment];
	return {
		index,
		text: segments.map((segment) => segment.text).join(""),
		segments,
	};
}

function normalizeStyle(style: TerminalStyle): TerminalStyle {
	const next: TerminalStyle = {};
	if (style.bold) next.bold = true;
	if (style.dim) next.dim = true;
	if (style.underline) next.underline = true;
	if (style.foreground) next.foreground = style.foreground;
	if (style.background) next.background = style.background;
	return next;
}

function sameStyle(
	segment: TerminalRenderSegment,
	style: TerminalStyle,
): boolean {
	return (
		segment.bold === style.bold &&
		segment.dim === style.dim &&
		segment.underline === style.underline &&
		segment.foreground === style.foreground &&
		segment.background === style.background
	);
}
