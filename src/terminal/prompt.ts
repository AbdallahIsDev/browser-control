/**
 * Terminal Prompt Detection
 *
 * Heuristics for detecting when a shell is ready for input (prompt visible).
 * Supports bash, sh, zsh, pwsh, and powershell.
 */

import { stripAnsi } from "./ansi";

// ── Prompt Patterns ──────────────────────────────────────────────────

/**
 * Common prompt endings across shells.
 * These are matched against the last non-empty line of terminal output.
 */
const PROMPT_PATTERNS: RegExp[] = [
	// bash/zsh: user@host:~/path$  or  user@host:~/path#
	/[@\w.-]+:[~\w./-]+[$#]\s*$/,
	// bash/zsh simple: $  or  # (at end of line)
	/^\s*[$#]\s*$/,
	// sh: $  or  # at start
	/^sh-[\d.]+[$#]\s*$/,
	// PowerShell: PS C:\path>  or  PS /path>
	/^PS\s+[\w:\\/.~-]+\s*>\s*$/,
	// PowerShell with username: [username@host path] PS>
	/^\[[\w@.-]+\s+[\w\-/\\]+\]\s*PS>\s*$/,
	// Windows cmd (just in case): C:\path>
	/^[A-Z]:\\[\w\\.-]+>\s*$/,
];

/**
 * Custom prompt regex the user can provide per-session.
 */
const customPatterns: Map<string, RegExp> = new Map();

// ── Public API ───────────────────────────────────────────────────────

/**
 * Register a custom prompt pattern for a session.
 */
export function registerCustomPrompt(sessionId: string, pattern: RegExp): void {
	customPatterns.set(sessionId, pattern);
}

/**
 * Remove a custom prompt pattern.
 */
export function unregisterCustomPrompt(sessionId: string): void {
	customPatterns.delete(sessionId);
}

/**
 * Check if the last line of output looks like a shell prompt.
 *
 * Returns true if the terminal is likely ready for input.
 */
export function isPromptDetected(output: string, sessionId?: string): boolean {
	const lines = output.split(/\r?\n/);
	// Walk backwards to find last non-empty line.
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = stripAnsi(lines[i] ?? "").trim();
		if (line.length === 0) continue;

		// Check custom pattern first.
		if (sessionId) {
			const custom = customPatterns.get(sessionId);
			if (custom?.test(line)) return true;
		}

		// Check built-in patterns.
		for (const pattern of PROMPT_PATTERNS) {
			if (pattern.test(line)) return true;
		}

		// If we found a non-empty line and it didn't match, stop.
		return false;
	}

	return false;
}

/**
 * Extract the current working directory from common prompt formats.
 *
 * Returns null if no cwd can be extracted.
 */
export function extractCwdFromPrompt(output: string): string | null {
	const lines = output.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = stripAnsi(lines[i] ?? "").trim();
		if (line.length === 0) continue;

		// bash/zsh: user@host:~/path$
		const bashMatch = line.match(/[@\w.-]+:([~\w./-]+)[$#]\s*$/);
		if (bashMatch?.[1]) {
			return bashMatch[1];
		}

		// PowerShell: PS C:\path>
		const psMatch = line.match(/^PS\s+([\w:\\/.~-]+)\s*>/);
		if (psMatch?.[1]) {
			return psMatch[1];
		}

		return null;
	}
	return null;
}
