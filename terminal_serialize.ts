/**
 * Terminal Serialization — Capture durable state from a live terminal session.
 *
 * Produces a `SerializedTerminalSession` that can be persisted and later
 * used to reconstruct the logical session.  Secrets in env are redacted.
 */

import type {
  SerializedTerminalSession,
  TerminalBufferRecord,
  TerminalResumeLevel,
} from "./terminal_resume_types";
import { redactString } from "./observability/redaction";

const DEFAULT_MAX_SCROLLBACK_LINES = 10_000;

/**
 * Patterns for env keys that likely contain secrets.
 * These are excluded from serialization to avoid storing credentials
 * in the durable store.
 */
const SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /cookie/i,
  /credential/i,
  /private[_-]?key/i,
  /passphrase/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

export interface TerminalSerializeOptions {
  maxScrollbackLines?: number;
}

/**
 * Redact sensitive env values, keeping the key with a placeholder.
 */
export function redactEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretKey(key)) {
      result[key] = "<redacted>";
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redact common command-line secret shapes before persisting terminal metadata.
 * Scrollback is preserved separately; this protects structured history/status
 * fields that are likely to be shown in CLI/API/MCP responses.
 */
export function redactCommandText(command: string): string {
  return command
    .replace(
      /\b([A-Z0-9_-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|AUTH|CREDENTIAL|PRIVATE[_-]?KEY|PASSPHRASE)[A-Z0-9_-]*)=(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=<redacted>",
    )
    .replace(
      /(\s--(?:password|passwd|secret|token|api[-_]?key|auth|credential|private[-_]?key|passphrase)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1<redacted>",
    )
    .replace(
      /(Authorization:\s*(?:Bearer|Basic)\s+)([^"'\s]+)/gi,
      "$1<redacted>",
    )
    .replace(
      /([?&](?:password|passwd|secret|token|api[_-]?key|apikey|auth|credential)=)([^&\s"']+)/gi,
      "$1<redacted>",
    );
}

function truncateLines(lines: string[], maxLines = DEFAULT_MAX_SCROLLBACK_LINES): string[] {
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

/**
 * Serialize a live terminal session into a durable model.
 *
 * @param session — The live terminal session (must expose internal state)
 * @returns The serialized model, or null if the session is closed.
 */
export function serializeTerminalSession(
  session: {
    id: string;
    name?: string;
    shell: string;
    cwd: string;
    env: Record<string, string>;
    status: string;
    createdAt: string;
    lastActivityAt: string;
    /** Access to output buffer (internal). */
    _outputBuffer?: string;
    /** Access to running command (internal). */
    _runningCommand?: string | undefined;
    /** Access to command history (internal). */
    _history?: string[];
    /** Access to process pid (internal). */
    pid?: number;
  },
  options: TerminalSerializeOptions = {},
): SerializedTerminalSession | null {
  if (session.status === "closed") {
    return null;
  }

  const outputBuffer = typeof session._outputBuffer === "string" ? session._outputBuffer : "";
  const hasBuffer = outputBuffer.length > 0;
  const resumeLevel: TerminalResumeLevel = hasBuffer ? 2 : 1;

  const scrollbackBuffer = hasBuffer
    ? truncateLines(outputBuffer.split(/\r?\n/), options.maxScrollbackLines).map(redactString)
    : [];

  return {
    sessionId: session.id,
    name: session.name,
    shell: session.shell,
    cwd: session.cwd,
    env: redactEnv(session.env),
    history: (session._history ?? []).map(redactCommandText),
    scrollbackBuffer,
    runningCommand: session._runningCommand ? redactCommandText(session._runningCommand) : undefined,
    processInfo: session.pid ? { pid: session.pid } : undefined,
    status: session.status as "idle" | "running" | "interrupted" | "closed",
    resumeLevel,
    serializedAt: new Date().toISOString(),
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
  };
}

/**
 * Validate the durable shape before using persisted terminal state to
 * reconstruct a new PTY. This intentionally checks only the fields needed
 * for safe v1 metadata/buffer resume.
 */
export function validateSerializedSession(value: unknown): value is SerializedTerminalSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SerializedTerminalSession>;
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.shell === "string" &&
    candidate.shell.length > 0 &&
    typeof candidate.cwd === "string" &&
    candidate.cwd.length > 0 &&
    candidate.env !== undefined &&
    typeof candidate.env === "object" &&
    Array.isArray(candidate.history) &&
    Array.isArray(candidate.scrollbackBuffer) &&
    (candidate.status === "idle" ||
      candidate.status === "running" ||
      candidate.status === "interrupted" ||
      candidate.status === "closed") &&
    (candidate.resumeLevel === 1 || candidate.resumeLevel === 2) &&
    typeof candidate.serializedAt === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.lastActivityAt === "string"
  );
}

/**
 * Build a TerminalBufferRecord from a live session's output buffer.
 */
export function captureTerminalBuffer(
  sessionId: string,
  outputBuffer: string,
  maxLines?: number,
): TerminalBufferRecord {
  const lines = outputBuffer.split(/\r?\n/);
  const scrollback = maxLines && lines.length > maxLines
    ? lines.slice(lines.length - maxLines)
    : lines;
  const redactedScrollback = scrollback.map(redactString);
  const redactedVisibleContent = redactString(outputBuffer).slice(-4096);

  return {
    sessionId,
    scrollback: redactedScrollback,
    visibleContent: redactedVisibleContent,
    capturedAt: new Date().toISOString(),
  };
}
