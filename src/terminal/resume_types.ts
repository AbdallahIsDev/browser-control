/**
 * Terminal Resume Types — Core interfaces for terminal state serialization
 * and resume (Section 13).
 *
 * These types define the durable serialized model that survives daemon
 * restarts, and the explicit resume metadata that tells consumers what
 * was preserved and what was lost.
 */

// ── Resume Levels ──────────────────────────────────────────────────────

/**
 * Resume levels define how much state was recovered.
 *
 * Level 1: Metadata only (shell, cwd, env, config). The PTY process was
 * recreated with the same settings.
 *
 * Level 2: Metadata + buffer (scrollback, visible content). The agent can
 * see what was on screen before the restart.
 */
export type TerminalResumeLevel = 1 | 2;

/**
 * Honest resume status.
 *
 * - "fresh":   New session with no prior state.
 * - "resumed": Metadata + buffer restored (Level 2).
 * - "reconstructed": Metadata restored, buffer missing or corrupt (Level 1).
 */
export type TerminalResumeStatus = "fresh" | "resumed" | "reconstructed";

// ── Serialized Terminal Session ────────────────────────────────────────

export interface SerializedTerminalSession {
  /** Logical session id — preserved across daemon restarts. */
  sessionId: string;
  /** Human-readable session name. */
  name?: string;
  /** Shell name (e.g. "bash", "pwsh"). */
  shell: string;
  /** Working directory. */
  cwd: string;
  /** Effective environment variables (secrets redacted). */
  env: Record<string, string>;
  /** Command history (commands sent to the session). */
  history: string[];
  /** Prompt signature regex string if detected. */
  promptSignature?: string;
  /** Scrollback buffer lines. */
  scrollbackBuffer: string[];
  /** Cursor position if known. */
  cursorPosition?: { row: number; col: number };
  /** Last running command if any. */
  runningCommand?: string;
  /** Process diagnostics (informational only in v1). */
  processInfo?: { pid?: number; commandLine?: string };
  /** Session status at time of serialization. */
  status: "idle" | "running" | "interrupted" | "closed";
  /** Resume level that was achieved during serialization. */
  resumeLevel: TerminalResumeLevel;
  /** ISO timestamp when this record was serialized. */
  serializedAt: string;
  /** ISO timestamp when the session was originally created. */
  createdAt: string;
  /** ISO timestamp of last activity. */
  lastActivityAt: string;
}

// ── Terminal Buffer Record ─────────────────────────────────────────────

export interface TerminalBufferRecord {
  sessionId: string;
  scrollback: string[];
  visibleContent: string;
  cursorPosition?: { row: number; col: number };
  capturedAt: string;
}

// ── Resume Result ──────────────────────────────────────────────────────

export interface TerminalResumeResult {
  /** Same logical session id that existed before shutdown. */
  sessionId: string;
  /** Resume level achieved. */
  resumeLevel: TerminalResumeLevel;
  /** Honest status. */
  status: TerminalResumeStatus;
  /** What was successfully preserved. */
  preserved: {
    metadata: boolean;
    buffer: boolean;
  };
  /** What was NOT preserved (human-readable list). */
  lost: string[];
  /** The reconstructed terminal session (fresh PTY). */
  session?: {
    id: string;
    shell: string;
    cwd: string;
    status: string;
  };
}

// ── Resume Metadata (attached to live sessions) ────────────────────────

export interface TerminalResumeMetadata {
  /** Was this session restored from persisted state? */
  restored: boolean;
  /** Resume level if restored. */
  resumeLevel?: TerminalResumeLevel;
  /** Resume status if restored. */
  status?: TerminalResumeStatus;
  /** What was preserved. */
  preserved?: { metadata: boolean; buffer: boolean };
  /** What was lost. */
  lost?: string[];
  /** Prior status captured before daemon restart, if different from current PTY status. */
  priorStatus?: "idle" | "running" | "interrupted" | "closed";
  /** Prior running command captured before daemon restart. It is not re-executed in v1. */
  priorRunningCommand?: string;
  /** ISO timestamp of original creation (before any restarts). */
  originalCreatedAt?: string;
  /** ISO timestamp when this session was reconstructed. */
  reconstructedAt?: string;
}

// ── Config Knobs ───────────────────────────────────────────────────────

export interface TerminalResumeConfig {
  /** How to handle terminal sessions on daemon startup. */
  resumePolicy: "resume" | "metadata_only" | "abandon";
  /** Max scrollback lines to persist per session. */
  maxScrollbackLines: number;
  /** Max serialized terminal sessions to keep. */
  maxSerializedSessions: number;
}
