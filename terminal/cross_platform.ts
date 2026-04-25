/**
 * Cross-Platform Shell Detection
 *
 * Detects the best available shell for the current platform.
 * Supports: bash, sh, pwsh, powershell.
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
 *   Windows: pwsh > powershell
 */
export function detectShell(): ShellInfo {
  if (isWindows) {
    for (const name of ["pwsh", "powershell"]) {
      const resolved = resolveShell(name);
      if (resolved) {
        return {
          name,
          path: resolved,
          args: shellArgs(name),
          ptyCapable: true,
          family: "windows",
        };
      }
    }
    throw new Error("No PowerShell found. Install PowerShell or PowerShell Core.");
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
  const resolved = resolveShell(name);
  if (!resolved) {
    throw new Error(`Shell "${name}" not found on this system.`);
  }
  const lower = name.toLowerCase();
  const family: "posix" | "windows" = (lower === "pwsh" || lower === "powershell") ? "windows" : "posix";
  return {
    name,
    path: resolved,
    args: shellArgs(name),
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
