/**
 * Terminal Snapshot — Terminal state capture.
 *
 * Provides snapshot functionality similar to a11y snapshots for the browser path,
 * but for native terminal sessions. Used by Section 5 (Action Surface) and
 * Section 13 (Terminal Resume).
 */

import type { TerminalSnapshot } from "./types";
import type { TerminalSessionManager } from "./session";
import { getDefaultSessionManager } from "./session";

// ── Snapshot Collection ──────────────────────────────────────────────

export interface SessionSnapshotCollection {
  timestamp: string;
  totalSessions: number;
  sessions: TerminalSnapshot[];
}

/**
 * Capture a snapshot of a single terminal session.
 */
export async function captureSessionSnapshot(
  sessionId: string,
  manager?: TerminalSessionManager,
): Promise<TerminalSnapshot> {
  const mgr = manager ?? getDefaultSessionManager();
  const session = mgr.get(sessionId);
  if (!session) {
    throw new Error(`Terminal session not found: ${sessionId}`);
  }
  return session.snapshot();
}

/**
 * Capture snapshots of all active terminal sessions.
 */
export async function captureAllSnapshots(
  manager?: TerminalSessionManager,
): Promise<SessionSnapshotCollection> {
  const mgr = manager ?? getDefaultSessionManager();
  const sessions = mgr.list();

  const snapshots = await Promise.all(
    sessions.map((s) => s.snapshot()),
  );

  return {
    timestamp: new Date().toISOString(),
    totalSessions: snapshots.length,
    sessions: snapshots,
  };
}

/**
 * Format a terminal snapshot as a human-readable summary.
 */
export function formatSnapshot(snapshot: TerminalSnapshot): string {
  const lines: string[] = [];
  lines.push(`Session: ${snapshot.sessionId.slice(0, 8)}...`);
  if (snapshot.name) {
    lines.push(`  Name: ${snapshot.name}`);
  }
  lines.push(`  Shell: ${snapshot.shell}`);
  lines.push(`  CWD: ${snapshot.cwd}`);
  lines.push(`  Status: ${snapshot.status}`);
  lines.push(`  Prompt Ready: ${snapshot.promptDetected ? "yes" : "no"}`);
  lines.push(`  Scrollback: ${snapshot.scrollbackLines} lines`);

  if (snapshot.runningCommand) {
    lines.push(`  Running: ${snapshot.runningCommand}`);
  }

  if (snapshot.lastOutput) {
    lines.push("  Last Output:");
    // Show last 5 lines
    const outputLines = snapshot.lastOutput.split(/\r?\n/).filter(Boolean);
    const recent = outputLines.slice(-5);
    for (const line of recent) {
      lines.push(`    ${line}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a collection of snapshots for CLI display.
 */
export function formatSnapshotCollection(collection: SessionSnapshotCollection): string {
  if (collection.totalSessions === 0) {
    return "No active terminal sessions.";
  }

  const lines: string[] = [];
  lines.push(`Terminal Sessions (${collection.totalSessions}) — ${collection.timestamp}`);
  lines.push("─".repeat(60));

  for (const snapshot of collection.sessions) {
    lines.push(formatSnapshot(snapshot));
    lines.push("─".repeat(60));
  }

  return lines.join("\n");
}
