/**
 * Terminal Exec — Structured one-shot command execution.
 *
 * Higher-level exec wrapper with convenience methods for common patterns.
 * All commands go through the policy engine when a policy context is provided.
 */

import { execCommand } from "./session";
import type { ExecOptions, ExecResult } from "./types";

// ── Extended Exec Options ────────────────────────────────────────────

export interface StructuredExecOptions extends ExecOptions {
  /** Retry count on non-zero exit (default: 0 = no retry). */
  retries?: number;
  /** Delay between retries in ms. */
  retryDelayMs?: number;
  /** If true, throw on non-zero exit code. Default: true. */
  throwOnFailure?: boolean;
}

// ── Structured Exec Result ───────────────────────────────────────────

export interface StructuredExecResult extends ExecResult {
  /** The command that was executed. */
  command: string;
  /** Whether the command succeeded (exit code 0). */
  success: boolean;
  /** Number of attempts made (1 = no retries). */
  attempts: number;
  /** Combined output (stdout + stderr) for convenience. */
  combinedOutput: string;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Execute a command with structured output.
 *
 * Wraps execCommand with retry logic, failure handling, and clean output.
 */
export async function exec(
  command: string,
  options: StructuredExecOptions = {},
): Promise<StructuredExecResult> {
  const maxAttempts = (options.retries ?? 0) + 1;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const throwOnFailure = options.throwOnFailure ?? true;

  let lastResult: ExecResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(retryDelayMs);
    }

    lastResult = await execCommand(command, options);

    if (lastResult.exitCode === 0) {
      return buildStructuredResult(command, lastResult, attempt, false);
    }

    // Non-zero exit — retry if we have attempts left
    if (attempt < maxAttempts) {
      continue;
    }
  }

  // All attempts exhausted
  const result = buildStructuredResult(command, lastResult!, maxAttempts, true);

  if (throwOnFailure) {
    throw new ExecError(result);
  }

  return result;
}

/**
 * Execute a command and return only stdout.
 * Throws on non-zero exit.
 */
export async function execStdout(
  command: string,
  options: ExecOptions = {},
): Promise<string> {
  const result = await exec(command, { ...options, throwOnFailure: true });
  return result.stdout;
}

/**
 * Execute a command and return true if exit code is 0.
 * Never throws.
 */
export async function execTest(
  command: string,
  options: ExecOptions = {},
): Promise<boolean> {
  try {
    const result = await execCommand(command, options);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Execute multiple commands sequentially in the same session.
 * Stops on first failure.
 */
export async function execSequence(
  commands: string[],
  options: StructuredExecOptions = {},
): Promise<StructuredExecResult[]> {
  const results: StructuredExecResult[] = [];
  for (const command of commands) {
    const result = await exec(command, options);
    results.push(result);
    if (!result.success && (options.throwOnFailure ?? true)) {
      break;
    }
  }
  return results;
}

// ── ExecError ────────────────────────────────────────────────────────

export class ExecError extends Error {
  readonly result: StructuredExecResult;

  constructor(result: StructuredExecResult) {
    super(`Command failed (${result.exitCode}): ${result.command}\n${result.stderr || result.stdout}`);
    this.name = "ExecError";
    this.result = result;
  }
}

// ── Utilities ────────────────────────────────────────────────────────

function buildStructuredResult(
  command: string,
  result: ExecResult,
  attempts: number,
  isFinalFailure: boolean,
): StructuredExecResult {
  return {
    ...result,
    command,
    success: result.exitCode === 0 && !isFinalFailure,
    attempts,
    combinedOutput: [result.stdout, result.stderr].filter(Boolean).join("\n"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
