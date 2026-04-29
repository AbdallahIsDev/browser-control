/**
 * Local Temp Sandbox Provider — v1 sandbox for helper validation.
 *
 * Creates a temp workspace under OS temp or data home, copies helper files,
 * runs bounded validation commands, and cleans up.
 *
 * No Docker, CubeSandbox, E2B, KVM, or cloud dependency.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { SandboxProvider, SandboxRunResult } from "./types";

const SAFE_SANDBOX_COMMANDS = new Set(["node", "npm", "npx"]);
const UNSAFE_SHELL_CHARS = /[&|;<>()`$\r\n]/;

function parseSandboxCommand(command: string): { executable: string; args: string[] } {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Sandbox command is required");
  if (UNSAFE_SHELL_CHARS.test(trimmed)) {
    throw new Error("Sandbox command contains unsupported shell control characters");
  }

  const parts = trimmed.split(/\s+/);
  const executable = parts[0];
  if (!SAFE_SANDBOX_COMMANDS.has(executable)) {
    throw new Error(`Sandbox command is not allowed: ${executable}`);
  }
  return { executable, args: parts.slice(1) };
}

export class LocalTempSandbox implements SandboxProvider {
  readonly kind = "local-temp" as const;
  private tempDir: string | null = null;

  async run(command: string, files: string[], workDir: string): Promise<SandboxRunResult> {
    const startMs = Date.now();

    try {
      this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-harness-"));

      // Copy helper files into sandbox
      for (const file of files) {
        if (path.isAbsolute(file)) {
          throw new Error(`Refusing absolute helper file path: ${file}`);
        }
        const src = path.resolve(workDir, file);
        const workRoot = path.resolve(workDir);
        const srcRelative = path.relative(workRoot, src);
        if (srcRelative.startsWith("..") || path.isAbsolute(srcRelative)) {
          throw new Error(`Refusing helper path outside workDir: ${file}`);
        }
        const dst = path.resolve(this.tempDir, file);
        const dstRelative = path.relative(this.tempDir, dst);
        if (dstRelative.startsWith("..") || path.isAbsolute(dstRelative)) {
          throw new Error(`Refusing helper path outside sandbox: ${file}`);
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
        }
      }

      const parsed = parseSandboxCommand(command);

      // Run bounded command (max 30s timeout) without a shell.
      const output = execFileSync(parsed.executable, parsed.args, {
        cwd: this.tempDir,
        timeout: 30000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      return {
        success: true,
        output,
        durationMs: Date.now() - startMs,
        exitCode: 0,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error,
        durationMs: Date.now() - startMs,
        exitCode: (err as { status?: number }).status ?? 1,
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
  }
}
