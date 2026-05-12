/** Package System Types */

export type PackagePermissionKind = "browser" | "filesystem" | "terminal" | "network" | "helper";

export interface BrowserPermission { kind: "browser"; domains: string[]; }
export interface FilesystemPermission { kind: "filesystem"; paths: string[]; access: "read" | "write" | "read-write"; }
export interface TerminalPermission { kind: "terminal"; commands: string[]; }
export interface NetworkPermission { kind: "network"; domains: string[]; }
export interface HelperPermission { kind: "helper"; helperIds: string[]; }

export type PackagePermission = BrowserPermission | FilesystemPermission | TerminalPermission | NetworkPermission | HelperPermission;

export interface PackagePermissionDecision { permission: PackagePermission; granted: boolean; reason?: string; }

export interface AutomationPackageManifest {
  schemaVersion: "1";
  name: string;
  version: string;
  description: string;
  browserControlVersion: string;
  permissions: PackagePermission[];
  configSchema?: unknown;
  uiSpec?: string;
  workflows?: string[];
  helpers?: string[];
  evals?: string[];
  entrypoints?: Record<string, string>;
  provenance?: { source?: string; license?: string; homepage?: string; };
  trust?: { signer?: string; digest?: string; signature?: string; reviewedAt?: string; reviewedBy?: string; };
}

export interface PackageEvalDefinition { id: string; name: string; workflow: string; expectedStatus: "completed" | "failed"; timeoutMs?: number; }
export interface PackageEvalResult { evalId: string; name: string; status: "passed" | "failed" | "skipped"; durationMs: number; error?: string; artifacts?: string[]; }
export interface PackageEvalSummary { runAt: string; total: number; passed: number; failed: number; skipped: number; durationMs: number; }

export interface InstalledAutomationPackage {
  name: string; version: string; source: string; installedPath: string;
  installedAt: string; updatedAt: string; enabled: boolean;
  permissions: PackagePermissionDecision[]; validationStatus: "valid" | "invalid" | "warning";
  validationErrors: string[]; workflows: string[]; helpers: string[]; evals: string[];
  lastEvalResult?: PackageEvalSummary;
  trustStatus?: TrustReviewStatus;
  signer?: string; digest?: string;
}

export type TrustReviewStatus = "unreviewed" | "pending" | "approved" | "rejected";

export interface TrustReviewResult {
  status: TrustReviewStatus; reviewedAt?: string; reviewedBy?: string;
  riskSummary?: { riskLevel: "low" | "medium" | "high" | "critical"; warnings: string[]; };
  permissions: PackagePermissionDecision[];
}

export interface PackageSourceConfig { kind: "local" | "remote"; url?: string; name: string; enabled: boolean; }

export interface PackageEvalRecord {
  id: string; packageName: string; version: string; status: "passed" | "failed";
  durationMs: number; totalEvals: number; passedEvals: number; failedEvals: number;
  failedStep?: string; debugReceiptId?: string; runAt: string;
}
