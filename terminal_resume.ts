/**
 * Terminal Resume — Reconstruct terminal sessions from persisted state.
 *
 * Determines resume level, preserves logical session identity, and returns
 * explicit metadata about what was preserved and what was lost.
 */

import type {
  SerializedTerminalSession,
  TerminalResumeResult,
  TerminalResumeLevel,
  TerminalResumeStatus,
  TerminalBufferRecord,
} from "./terminal_resume_types";
import { TerminalBufferStore } from "./terminal_buffer_store";
import { redactCommandText, validateSerializedSession } from "./terminal_serialize";

export interface ResumeDecision {
  sessionId: string;
  resumeLevel: TerminalResumeLevel;
  status: TerminalResumeStatus;
  preserved: { metadata: boolean; buffer: boolean };
  lost: string[];
}

/**
 * Decide how to resume a session based on what data is available.
 *
 * - If metadata + valid buffer exist → Level 2 (resumed)
 * - If metadata only (or buffer corrupt) → Level 1 (reconstructed)
 * - If nothing exists → fresh (caller should create normally)
 */
export function decideResume(
  sessionId: string,
  metadata: SerializedTerminalSession | null,
  buffer: TerminalBufferRecord | null,
): ResumeDecision {
  if (!metadata) {
    return {
      sessionId,
      resumeLevel: 1,
      status: "fresh",
      preserved: { metadata: false, buffer: false },
      lost: ["no prior state"],
    };
  }

  const hasBuffer = buffer !== null && Array.isArray(buffer.scrollback) && buffer.scrollback.length > 0;
  const bufferCorrupt = buffer !== null && !Array.isArray(buffer.scrollback);

  const lost: string[] = [];
  if (metadata.status === "running" || metadata.runningCommand || metadata.processInfo?.pid) {
    lost.push("live process continuity");
    if (metadata.runningCommand) {
      lost.push(`running command was not continued: ${redactCommandText(metadata.runningCommand)}`);
    }
  }

  if (hasBuffer) {
    return {
      sessionId,
      resumeLevel: 2,
      status: "resumed",
      preserved: { metadata: true, buffer: true },
      lost,
    };
  }

  if (bufferCorrupt) {
    return {
      sessionId,
      resumeLevel: 1,
      status: "reconstructed",
      preserved: { metadata: true, buffer: false },
      lost: [...lost, "buffer was corrupt"],
    };
  }

  return {
    sessionId,
    resumeLevel: 1,
    status: "reconstructed",
    preserved: { metadata: true, buffer: false },
    lost: [...lost, "buffer was not persisted"],
  };
}

/**
 * Load persisted terminal state from the buffer store.
 */
export function loadPersistedState(
  store: TerminalBufferStore,
  sessionId: string,
): { metadata: SerializedTerminalSession | null; buffer: TerminalBufferRecord | null } {
  const rawMetadata = store.loadSession(sessionId);
  let metadata: SerializedTerminalSession | null = null;
  if (validateSerializedSession(rawMetadata)) {
    metadata = rawMetadata;
  }

  const buffer = store.loadBuffer(sessionId);
  return { metadata, buffer };
}

/**
 * Build a TerminalResumeResult from a resume decision and reconstructed session info.
 */
export function buildResumeResult(
  decision: ResumeDecision,
  session?: { id: string; shell: string; cwd: string; status: string },
): TerminalResumeResult {
  return {
    sessionId: decision.sessionId,
    resumeLevel: decision.resumeLevel,
    status: decision.status,
    preserved: decision.preserved,
    lost: decision.lost,
    session,
  };
}

/**
 * Merge scrollback buffer back into an output buffer string for a reconstructed session.
 */
export function rebuildOutputBuffer(buffer: TerminalBufferRecord | null): string {
  if (!buffer || !Array.isArray(buffer.scrollback)) return "";
  return buffer.scrollback.join("\n");
}
