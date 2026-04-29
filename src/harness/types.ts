/**
 * Harness Types — Self-healing helper manifest, validation, and registry types.
 *
 * Helpers live outside core source, under Browser Control data home.
 * They are registered by metadata and must pass validation before use.
 */

// ── Helper Manifest ───────────────────────────────────────────────────

export interface HarnessHelperManifest {
  id: string;
  site?: string;
  domains?: string[];
  taskTags: string[];
  failureTypes: string[];
  files: string[];
  usage: string;
  purpose: string;
  version: string;
  previousVersions?: string[];
  testCommand?: string;
  lastVerifiedAt?: string;
  activated: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Validation ────────────────────────────────────────────────────────

export interface HelperValidationCheck {
  name: string;
  status: "passed" | "failed";
  message?: string;
}

export interface HelperValidationResult {
  helperId: string;
  status: "passed" | "failed";
  checks: HelperValidationCheck[];
}

// ── Sandbox Provider ──────────────────────────────────────────────────

export type SandboxProviderKind = "local-temp";

export interface SandboxRunResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs: number;
}

export interface SandboxProvider {
  kind: SandboxProviderKind;
  run(command: string, files: string[], workDir: string): Promise<SandboxRunResult>;
  cleanup(): Promise<void>;
}
