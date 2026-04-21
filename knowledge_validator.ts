/**
 * Knowledge Validator — Lint Knowledge Files for Issues
 *
 * Checks:
 * - Missing required frontmatter fields
 * - Secrets/tokens/passwords/API keys accidentally stored
 * - Invalid entry structure
 * - Stale references (verified > 30 days ago)
 * - Duplicate entries
 */

import type {
  KnowledgeArtifact,
  KnowledgeFrontmatter,
  KnowledgeEntry,
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,
} from "./knowledge_types";

// ── Secret Detection ────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // API keys / tokens (generic)
  { pattern: /\b(?:api[_-]?key|apikey|api[_-]?token|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}/i, label: "API key or token" },
  // Bearer tokens
  { pattern: /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i, label: "Bearer token" },
  // AWS keys
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, label: "AWS access key" },
  // Generic long hex/base64 that looks like a secret
  { pattern: /\b(?:sk|pk|rk)[-_](?:live|test|prod)[a-zA-Z0-9]{20,}\b/, label: "Stripe-style secret key" },
  // Private keys
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, label: "Private key" },
  // GitHub tokens
  { pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/, label: "GitHub token" },
  // Passwords
  { pattern: /\b(?:password|passwd|pwd|secret)\s*[:=]\s*['"]?[^\s'"]{4,}/i, label: "Password or secret" },
  // JWT
  { pattern: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, label: "JWT token" },
  // Cookie values that look like session tokens
  { pattern: /\bcookie\s*[:=]\s*['"]?[a-zA-Z0-9_\-+=/]{32,}/i, label: "Cookie/session value" },
];

function detectSecrets(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          severity: "error",
          message: `Possible secret detected: ${label}. Knowledge files must not contain credentials.`,
          line: i + 1,
        });
      }
    }
  }

  return issues;
}

// ── Frontmatter Validation ──────────────────────────────────────────

function validateFrontmatter(fm: KnowledgeFrontmatter): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!fm.kind) {
    issues.push({ severity: "error", message: "Missing required field: kind" });
  } else if (fm.kind !== "interaction-skill" && fm.kind !== "domain-skill") {
    issues.push({ severity: "error", message: `Invalid kind: "${fm.kind}". Must be "interaction-skill" or "domain-skill".` });
  }

  if (!fm.capturedAt) {
    issues.push({ severity: "error", message: "Missing required field: capturedAt" });
  } else if (isNaN(Date.parse(fm.capturedAt))) {
    issues.push({ severity: "error", message: `Invalid capturedAt timestamp: "${fm.capturedAt}"` });
  }

  if (fm.kind === "domain-skill" && !fm.domain) {
    issues.push({ severity: "error", message: "Domain-skill files must have a 'domain' field in frontmatter." });
  }

  if (fm.kind === "interaction-skill" && !fm.name) {
    issues.push({ severity: "warning", message: "Interaction-skill files should have a 'name' field in frontmatter." });
  }

  if (fm.updatedAt && isNaN(Date.parse(fm.updatedAt))) {
    issues.push({ severity: "error", message: `Invalid updatedAt timestamp: "${fm.updatedAt}"` });
  }

  if (fm.lastVerified && isNaN(Date.parse(fm.lastVerified))) {
    issues.push({ severity: "error", message: `Invalid lastVerified timestamp: "${fm.lastVerified}"` });
  }

  return issues;
}

// ── Entry Validation ────────────────────────────────────────────────

const STALE_DAYS = 30;

function validateEntries(entries: KnowledgeEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenDescriptions = new Set<string>();
  const now = Date.now();
  const staleThreshold = STALE_DAYS * 24 * 60 * 60 * 1000;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!entry.description || entry.description.trim().length === 0) {
      issues.push({ severity: "error", message: `Entry ${i + 1} has an empty description.` });
      continue;
    }

    // Duplicate detection
    const key = entry.description.toLowerCase().trim();
    if (seenDescriptions.has(key)) {
      issues.push({ severity: "warning", message: `Duplicate entry: "${entry.description}"` });
    }
    seenDescriptions.add(key);

    // Stale reference check
    if (entry.verified && entry.lastVerified) {
      const lastVerifiedMs = Date.parse(entry.lastVerified);
      if (!isNaN(lastVerifiedMs) && (now - lastVerifiedMs > staleThreshold)) {
        issues.push({
          severity: "warning",
          message: `Entry "${entry.description}" was last verified ${entry.lastVerified} — may be stale (>${STALE_DAYS} days).`,
        });
      }
    }

    // Selector format check
    if (entry.selector) {
      if (entry.selector.length < 2) {
        issues.push({ severity: "warning", message: `Entry "${entry.description}" has a suspiciously short selector: "${entry.selector}"` });
      }
    }

    // Wait condition sanity
    if (entry.waitMs !== undefined && (entry.waitMs < 0 || entry.waitMs > 60000)) {
      issues.push({ severity: "warning", message: `Entry "${entry.description}" has unusual waitMs: ${entry.waitMs}` });
    }
  }

  return issues;
}

// ── Body Structure Validation ───────────────────────────────────────

function validateBody(body: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (body.trim().length === 0) {
    issues.push({ severity: "warning", message: "Knowledge file body is empty — add structured sections for useful knowledge." });
  }

  // Check for at least one recognized section heading
  const sectionHeadings = body.match(/^##\s+.+/gm) ?? [];
  if (sectionHeadings.length === 0) {
    issues.push({ severity: "warning", message: "No section headings (## ...) found. Structured sections improve searchability." });
  }

  return issues;
}

// ── Main Validator ──────────────────────────────────────────────────

export function validateArtifact(artifact: KnowledgeArtifact): ValidationResult {
  const issues: ValidationIssue[] = [
    ...validateFrontmatter(artifact.frontmatter),
    ...validateBody(artifact.body),
    ...validateEntries(artifact.entries),
    ...detectSecrets(`${artifact.body}`),
  ];

  // Also scan frontmatter for secrets (e.g., domain name shouldn't have secrets but just in case)
  const fmString = JSON.stringify(artifact.frontmatter);
  issues.push(...detectSecrets(fmString));

  // Filter: if there are errors, it's invalid
  const hasErrors = issues.some((i) => i.severity === "error");

  return {
    filePath: artifact.filePath,
    valid: !hasErrors,
    issues,
  };
}

export function validateFile(filePath: string): ValidationResult | null {
  // Lazy import to avoid circular dependency at module level
  const { loadArtifact } = require("./knowledge_store") as typeof import("./knowledge_store");
  const artifact = loadArtifact(filePath);
  if (!artifact) return null;
  return validateArtifact(artifact);
}
