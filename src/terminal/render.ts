/**
 * Terminal Render Models — Browser terminal view adapters.
 *
 * Converts native terminal session snapshots into semantic render state
 * for dashboard and agent accessibility consumption.
 */

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
 * Strips basic ANSI escape codes to produce clean text for rendering/a11y.
 * Note: A real terminal emulator would parse these for styles, but our
 * semantic view prioritizes structure over raw colors for agents.
 */
function stripAnsi(text: string): string {
  // Simple regex for ANSI escape sequences
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Builds a deterministic view of the terminal state suitable for browser rendering
 * or agent DOM inspection.
 */
export function buildTerminalView(snapshot: TerminalSnapshot): BrowserTerminalView {
  const cleanOutput = stripAnsi(snapshot.lastOutput);
  const rawRows = cleanOutput.split(/\r?\n/);
  
  const rows: TerminalRenderRow[] = rawRows.map((text, i) => ({
    index: i,
    text
  }));

  const statusMap: Record<TerminalSnapshot["status"], BrowserTerminalView["status"]> = {
    running: "running",
    idle: "idle",
    interrupted: "idle", // Ready for next command
    closed: "exited"
  };

  const status = statusMap[snapshot.status] ?? "exited";
  
  const canAcceptInput = snapshot.status === "idle" && snapshot.promptDetected === true;

  return {
    terminalSessionId: snapshot.sessionId,
    title: snapshot.name || snapshot.runningCommand || snapshot.shell,
    status,
    rows,
    canAcceptInput,
    lastActivityAt: snapshot.lastActivityAt
  };
}
