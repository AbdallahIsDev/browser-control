/**
 * Terminal Render Models — Browser terminal view adapters.
 *
 * Converts native terminal session snapshots into semantic render state
 * for dashboard and agent accessibility consumption.
 */

import { stripAnsi } from "./ansi";
import type { TerminalSnapshot } from "./types";

export interface TerminalRenderRow {
	index: number;
	text: string;
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

/**
 * Builds a deterministic view of the terminal state suitable for browser rendering
 * or agent DOM inspection.
 */
export function buildTerminalView(
	snapshot: TerminalSnapshot,
): BrowserTerminalView {
	const cleanOutput = stripAnsi(snapshot.lastOutput);
	const rawRows = cleanOutput.split(/\r?\n/);

	const rows: TerminalRenderRow[] = rawRows.map((text, i) => ({
		index: i,
		text,
	}));

	const statusMap: Record<
		TerminalSnapshot["status"],
		BrowserTerminalView["status"]
	> = {
		running: "running",
		idle: "idle",
		interrupted: "idle", // Ready for next command
		closed: "exited",
	};

	const status = statusMap[snapshot.status] ?? "exited";

	const canAcceptInput =
		snapshot.status === "idle" && snapshot.promptDetected === true;

	return {
		terminalSessionId: snapshot.sessionId,
		title: snapshot.name || snapshot.runningCommand || snapshot.shell,
		status,
		rows,
		canAcceptInput,
		lastActivityAt: snapshot.lastActivityAt,
	};
}
