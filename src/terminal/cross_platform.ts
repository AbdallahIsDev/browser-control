/**
 * Cross-Platform Shell Detection
 *
 * Detects the best available shell for the current platform.
 * Supports: bash, sh, pwsh. On Windows, "powershell" is a compatibility
 * alias for "pwsh" when PowerShell 7 is installed.
 */

import { execFileSync } from "node:child_process";
import os from "node:os";

// ── Shell Info ───────────────────────────────────────────────────────

export interface ShellInfo {
	/** Shell name (e.g., "bash", "pwsh"). */
	name: string;
	/** Full path to the shell binary. */
	path: string;
	/** Arguments to start in interactive mode. */
	args: string[];
	/** Whether this shell supports PTY. */
	ptyCapable: boolean;
	/** Shell family: "posix" or "windows" */
	family: "posix" | "windows";
}

// ── Detection ────────────────────────────────────────────────────────

const isWindows = os.platform() === "win32";

/**
 * Try to resolve a shell binary path. Returns null if not found.
 */
function resolveShell(name: string): string | null {
	try {
		const whichCmd = isWindows ? "where" : "which";
		const result = execFileSync(whichCmd, [name], {
			encoding: "utf8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const firstLine = result.trim().split(/\r?\n/)[0];
		return firstLine || null;
	} catch {
		return null;
	}
}

/**
 * Build the argument list for launching a shell in interactive mode.
 */
function shellArgs(name: string): string[] {
	const lower = name.toLowerCase();
	if (lower === "bash" || lower === "zsh") {
		return ["--login", "-i"];
	}
	if (lower === "sh") {
		return ["-i"];
	}
	if (lower === "pwsh" || lower === "powershell") {
		return ["-NoLogo", "-NoProfile", "-Interactive"];
	}
	// Fallback: no special args
	return [];
}

/**
 * Get the preferred shell for the current platform.
 *
 * Order:
 *   Linux/macOS: bash > sh
 *   Windows: pwsh
 */
export function detectShell(): ShellInfo {
	if (isWindows) {
		const resolved = resolveShell("pwsh");
		if (resolved) {
			return {
				name: "pwsh",
				path: resolved,
				args: shellArgs("pwsh"),
				ptyCapable: true,
				family: "windows",
			};
		}
		throw new Error(
			"No supported Windows PTY shell found. Install PowerShell 7 (pwsh).",
		);
	}

	// Unix-like: prefer bash, fall back to sh
	for (const name of ["bash", "sh"]) {
		const resolved = resolveShell(name);
		if (resolved) {
			return {
				name,
				path: resolved,
				args: shellArgs(name),
				ptyCapable: true,
				family: "posix",
			};
		}
	}

	throw new Error("No supported shell found (tried bash, sh).");
}

/**
 * Resolve a user-specified shell name to a ShellInfo.
 * Throws if the shell is not found on the system.
 */
export function resolveNamedShell(name: string): ShellInfo {
	const lower = name.toLowerCase();
	const requested = isWindows && lower === "powershell" ? "pwsh" : lower;
	const resolved = resolveShell(requested);
	if (!resolved) {
		if (isWindows && lower === "powershell") {
			throw new Error(
				'Windows PowerShell 5.1 ("powershell") is not supported for PTY sessions. Install PowerShell 7 (pwsh) or request shell "pwsh".',
			);
		}
		throw new Error(`Shell "${name}" not found on this system.`);
	}
	const family: "posix" | "windows" =
		requested === "pwsh" ? "windows" : "posix";
	return {
		name: requested,
		path: resolved,
		args: shellArgs(requested),
		ptyCapable: true,
		family,
	};
}

/**
 * Detect the current platform shell name string.
 */
export function platformShellName(): string {
	return isWindows ? "pwsh" : "bash";
}

/**
 * Check if the current platform is Windows.
 */
export function isWindowsPlatform(): boolean {
	return isWindows;
}
