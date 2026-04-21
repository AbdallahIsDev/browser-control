/**
 * Knowledge System — Core Types
 *
 * Defines the data models for Browser Control's knowledge system:
 * - interaction skills (reusable browser patterns)
 * - domain skills (site-specific knowledge)
 */

// ── Knowledge Kind ─────────────────────────────────────────────────

export type KnowledgeKind = "interaction-skill" | "domain-skill";

// ── Knowledge Entry Types (within a domain-skill file) ──────────────

export type EntryType =
  | "stable-selector"
  | "pitfall"
  | "wait-condition"
  | "navigation-shortcut"
  | "api-endpoint"
  | "dom-quirk";

export interface KnowledgeEntry {
  type: EntryType;
  description: string;
  selector?: string;
  role?: string;
  name?: string;
  waitCondition?: string;
  waitMs?: number;
  pattern?: string;
  verified: boolean;
  lastVerified: string;
  capturedAt: string;
}

// ── Frontmatter Metadata ────────────────────────────────────────────

export interface KnowledgeFrontmatter {
  kind: KnowledgeKind;
  /** Domain name for domain-skill (e.g., "github.com"). Undefined for interaction-skill. */
  domain?: string;
  /** Human-readable name for interaction-skill (e.g., "modal-dialogs"). */
  name?: string;
  /** ISO timestamp of first capture. */
  capturedAt: string;
  /** ISO timestamp of last update. */
  updatedAt?: string;
  /** Whether the knowledge has been verified in a real run. */
  verified?: boolean;
  /** ISO timestamp of last verification. */
  lastVerified?: string;
  /** Free-form tags for categorization. */
  tags?: string[];
}

// ── Knowledge Artifact (parsed from a markdown file) ────────────────

export interface KnowledgeArtifact {
  /** Absolute file path. */
  filePath: string;
  /** Parsed frontmatter. */
  frontmatter: KnowledgeFrontmatter;
  /** Raw markdown body (without frontmatter). */
  body: string;
  /** Parsed sections from the markdown body, keyed by section heading. */
  sections: Record<string, string>;
  /** Parsed entries extracted from structured sections. */
  entries: KnowledgeEntry[];
  /** File modification time (ms since epoch). */
  mtimeMs: number;
}

// ── Knowledge Summary (for listing/index) ───────────────────────────

export interface KnowledgeSummary {
  kind: KnowledgeKind;
  /** Domain for domain-skill, name for interaction-skill. */
  identifier: string;
  filePath: string;
  capturedAt: string;
  updatedAt?: string;
  verified: boolean;
  entryCount: number;
  tags: string[];
}

// ── Validation ──────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  line?: number;
}

export interface ValidationResult {
  filePath: string;
  valid: boolean;
  issues: ValidationIssue[];
}

// ── Query Filters ───────────────────────────────────────────────────

export interface KnowledgeQueryFilter {
  kind?: KnowledgeKind;
  domain?: string;
  tags?: string[];
  verified?: boolean;
  /** Full-text search across description and body. */
  search?: string;
}

// ── Capture Hook Types (for future use) ─────────────────────────────

export interface CaptureContext {
  domain: string;
  sessionId: string;
  /** The action that triggered capture. */
  trigger: string;
  /** Raw observation data. */
  data: Record<string, unknown>;
}

export type CaptureHook = (context: CaptureContext) => KnowledgeEntry | null;
