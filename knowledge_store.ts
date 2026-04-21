/**
 * Knowledge Store — Read/Write/Parse Markdown Knowledge Files
 *
 * Canonical artifact: Markdown with YAML frontmatter.
 * Stores under ~/.browser-control/knowledge/{interaction-skills,domain-skills}/
 */

import fs from "node:fs";
import path from "node:path";

import { getInteractionSkillsDir, getDomainSkillsDir, getKnowledgeDir } from "./paths";
import { logger } from "./logger";
import type {
  KnowledgeKind,
  KnowledgeFrontmatter,
  KnowledgeArtifact,
  KnowledgeEntry,
  KnowledgeSummary,
  EntryType,
} from "./knowledge_types";

const log = logger.withComponent("knowledge-store");

// ── Frontmatter Parsing ─────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(text: string): { frontmatter: KnowledgeFrontmatter; body: string } {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("Missing YAML frontmatter (--- delimiters)");
  }

  const raw = match[1];
  const body = text.slice(match[0].length);

  const fm: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    // Strip quotes
    if (typeof value === "string") {
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Parse booleans
      if (value === "true") value = true;
      if (value === "false") value = false;
      // Parse arrays [a, b, c]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        value = inner ? inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")) : [];
      }
    }

    fm[key] = value;
  }

  if (!fm.kind || (fm.kind !== "interaction-skill" && fm.kind !== "domain-skill")) {
    throw new Error(`Invalid frontmatter kind: "${fm.kind}". Must be "interaction-skill" or "domain-skill".`);
  }

  const frontmatter: KnowledgeFrontmatter = {
    kind: fm.kind as KnowledgeKind,
    capturedAt: typeof fm.capturedAt === "string" ? fm.capturedAt : new Date().toISOString(),
    ...(fm.domain ? { domain: fm.domain as string } : {}),
    ...(fm.name ? { name: fm.name as string } : {}),
    ...(fm.updatedAt ? { updatedAt: fm.updatedAt as string } : {}),
    ...(fm.verified !== undefined ? { verified: fm.verified as boolean } : {}),
    ...(fm.lastVerified ? { lastVerified: fm.lastVerified as string } : {}),
    ...(Array.isArray(fm.tags) ? { tags: fm.tags as string[] } : {}),
  };

  return { frontmatter, body };
}

function serializeFrontmatter(fm: KnowledgeFrontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`kind: ${fm.kind}`);
  if (fm.domain) lines.push(`domain: "${fm.domain}"`);
  if (fm.name) lines.push(`name: "${fm.name}"`);
  lines.push(`capturedAt: "${fm.capturedAt}"`);
  if (fm.updatedAt) lines.push(`updatedAt: "${fm.updatedAt}"`);
  if (fm.verified !== undefined) lines.push(`verified: ${fm.verified}`);
  if (fm.lastVerified) lines.push(`lastVerified: "${fm.lastVerified}"`);
  if (fm.tags && fm.tags.length > 0) lines.push(`tags: [${fm.tags.join(", ")}]`);
  lines.push("---");
  return lines.join("\n");
}

// ── Markdown Section Parsing ────────────────────────────────────────

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let currentHeading = "_intro";
  let currentContent: string[] = [];

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections[currentHeading] = currentContent.join("\n").trim();
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    sections[currentHeading] = currentContent.join("\n").trim();
  }

  return sections;
}

// ── Entry Extraction ────────────────────────────────────────────────

const ENTRY_TYPE_MAP: Record<string, EntryType> = {
  "stable selectors": "stable-selector",
  "stable selector": "stable-selector",
  "selectors": "stable-selector",
  "pitfalls": "pitfall",
  "pitfall": "pitfall",
  "traps": "pitfall",
  "gotchas": "pitfall",
  "wait conditions": "wait-condition",
  "wait condition": "wait-condition",
  "waits": "wait-condition",
  "navigation shortcuts": "navigation-shortcut",
  "navigation shortcut": "navigation-shortcut",
  "shortcuts": "navigation-shortcut",
  "routes": "navigation-shortcut",
  "api endpoints": "api-endpoint",
  "api endpoint": "api-endpoint",
  "endpoints": "api-endpoint",
  "dom quirks": "dom-quirk",
  "dom quirk": "dom-quirk",
  "quirks": "dom-quirk",
};

function guessEntryType(heading: string): EntryType | null {
  return ENTRY_TYPE_MAP[heading.toLowerCase()] ?? null;
}

/**
 * Parse structured list entries from a section's content.
 *
 * Each list item (line starting with "- ") becomes exactly ONE entry.
 * Indented sub-fields after the list item populate that entry's fields.
 *
 * Example:
 *   - My button click
 *     selector: #submit
 *     role: button
 *
 * Produces ONE entry with description="My button click", selector="#submit", role="button".
 *
 * NOT two entries (old buggy behavior).
 */
function extractEntries(sections: Record<string, string>, capturedAtOverride?: string): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  const now = new Date().toISOString();

  for (const [heading, content] of Object.entries(sections)) {
    const type = guessEntryType(heading);
    if (!type) continue;

    const lines = content.split("\n");
    let currentEntry: KnowledgeEntry | null = null;

    for (const line of lines) {
      // List item: starts a new entry
      const listMatch = line.match(/^-\s+(.+)/);
      if (listMatch) {
        // Save previous entry
        if (currentEntry && currentEntry.description) {
          entries.push(currentEntry);
        }

        // Start new entry
        const desc = listMatch[1].trim();
        if (desc) {
          // Use frontmatter capturedAt if available, otherwise fall back to now.
          // This preserves the actual capture date from the artifact frontmatter
          // rather than always stamping entries with "today".
          const entryCapturedAt = capturedAtOverride ?? now;
          currentEntry = {
            type,
            description: desc,
            verified: false,
            lastVerified: now,
            capturedAt: entryCapturedAt,
          };
        } else {
          currentEntry = null;
        }
        continue;
      }

      // Sub-field: belongs to the current entry
      if (currentEntry) {
        const subFieldMatch = line.match(/^\s{2,}-?\s*(selector|role|name|waitCondition|waitMs|pattern|verified|lastVerified):\s*(.+)/i);
        if (subFieldMatch) {
          const field = subFieldMatch[1].toLowerCase();
          const value = subFieldMatch[2].trim();
          switch (field) {
            case "selector": currentEntry.selector = value; break;
            case "role": currentEntry.role = value; break;
            case "name": currentEntry.name = value; break;
            case "waitcondition": currentEntry.waitCondition = value; break;
            case "waitms": currentEntry.waitMs = Number(value) || undefined; break;
            case "pattern": currentEntry.pattern = value; break;
            case "verified": currentEntry.verified = value === "true"; break;
            case "lastverified": currentEntry.lastVerified = value; break;
          }
        }
      }
    }

    // Don't forget the last entry
    if (currentEntry && currentEntry.description) {
      entries.push(currentEntry);
    }
  }

  return entries;
}

// ── File I/O ────────────────────────────────────────────────────────

function slugifyDomain(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

function slugifyName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().replace(/-+/g, "-");
}

function getFilePathForKind(kind: KnowledgeKind, identifier: string): string {
  if (kind === "domain-skill") {
    return path.join(getDomainSkillsDir(), `${slugifyDomain(identifier)}.md`);
  }
  return path.join(getInteractionSkillsDir(), `${slugifyName(identifier)}.md`);
}

export function loadArtifact(filePath: string): KnowledgeArtifact | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const sections = parseSections(body);
    // Pass frontmatter's capturedAt so entries inherit the correct capture date.
    const entries = extractEntries(sections, frontmatter.capturedAt);
    const stat = fs.statSync(filePath);

    return {
      filePath: path.resolve(filePath),
      frontmatter,
      body,
      sections,
      entries,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error: unknown) {
    log.warn(`Failed to load knowledge artifact: ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function saveArtifact(
  kind: KnowledgeKind,
  identifier: string,
  frontmatter: KnowledgeFrontmatter,
  body: string,
): string {
  const filePath = getFilePathForKind(kind, identifier);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const fm: KnowledgeFrontmatter = {
    ...frontmatter,
    updatedAt: now,
  };

  const content = `${serializeFrontmatter(fm)}\n\n${body}\n`;
  fs.writeFileSync(filePath, content, "utf8");
  log.info(`Knowledge artifact saved: ${filePath}`);
  return filePath;
}

export function deleteArtifact(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.info(`Knowledge artifact deleted: ${filePath}`);
      return true;
    }
    return false;
  } catch (error: unknown) {
    log.warn(`Failed to delete knowledge artifact: ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ── Listing / Discovery ─────────────────────────────────────────────

function listArtifactsInDir(dir: string, kind: KnowledgeKind): KnowledgeSummary[] {
  if (!fs.existsSync(dir)) return [];

  const summaries: KnowledgeSummary[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    const artifact = loadArtifact(filePath);
    if (!artifact) continue;

    const identifier = kind === "domain-skill"
      ? (artifact.frontmatter.domain ?? entry.name.replace(/\.md$/, ""))
      : (artifact.frontmatter.name ?? entry.name.replace(/\.md$/, ""));

    summaries.push({
      kind,
      identifier,
      filePath: artifact.filePath,
      capturedAt: artifact.frontmatter.capturedAt,
      updatedAt: artifact.frontmatter.updatedAt,
      verified: artifact.frontmatter.verified ?? false,
      entryCount: artifact.entries.length,
      tags: artifact.frontmatter.tags ?? [],
    });
  }

  return summaries;
}

export function listAllKnowledge(): KnowledgeSummary[] {
  return [
    ...listArtifactsInDir(getInteractionSkillsDir(), "interaction-skill"),
    ...listArtifactsInDir(getDomainSkillsDir(), "domain-skill"),
  ];
}

export function listByKind(kind: KnowledgeKind): KnowledgeSummary[] {
  if (kind === "interaction-skill") {
    return listArtifactsInDir(getInteractionSkillsDir(), "interaction-skill");
  }
  return listArtifactsInDir(getDomainSkillsDir(), "domain-skill");
}

export function findByDomain(domain: string): KnowledgeArtifact | null {
  const filePath = path.join(getDomainSkillsDir(), `${slugifyDomain(domain)}.md`);
  return loadArtifact(filePath);
}

export function findByName(name: string): KnowledgeArtifact | null {
  const filePath = path.join(getInteractionSkillsDir(), `${slugifyName(name)}.md`);
  return loadArtifact(filePath);
}

// ── Rebuild Body from Entries ─────────────────────────────────────

/**
 * Group entries by their canonical section heading.
 * Key: heading name (e.g., "Stable Selectors"), Value: array of entries.
 */
function groupEntriesByHeading(entries: KnowledgeEntry[]): Record<string, KnowledgeEntry[]> {
  const byHeading: Record<string, KnowledgeEntry[]> = {};
  for (const entry of entries) {
    const sectionName = getSectionHeadingForType(entry.type);
    if (!byHeading[sectionName]) byHeading[sectionName] = [];
    byHeading[sectionName].push(entry);
  }
  return byHeading;
}

/**
 * Format a single entry as a markdown list item with indented sub-fields.
 */
function formatEntry(entry: KnowledgeEntry): string {
  const lines: string[] = [`- ${entry.description}`];
  if (entry.selector) lines.push(`  selector: ${entry.selector}`);
  if (entry.role) lines.push(`  role: ${entry.role}`);
  if (entry.name) lines.push(`  name: ${entry.name}`);
  if (entry.waitCondition) lines.push(`  waitCondition: ${entry.waitCondition}`);
  if (entry.waitMs !== undefined) lines.push(`  waitMs: ${entry.waitMs}`);
  if (entry.pattern) lines.push(`  pattern: ${entry.pattern}`);
  if (entry.verified) lines.push(`  verified: true`);
  if (entry.lastVerified) lines.push(`  lastVerified: ${entry.lastVerified}`);
  return lines.join("\n");
}

/**
 * Rebuild a section's markdown from filtered entries.
 * Produces: "## Section Name\n<entry1>\n<entry2>\n"
 */
function rebuildSection(heading: string, entries: KnowledgeEntry[]): string {
  const lines: string[] = [];
  lines.push(`## ${heading}`);
  for (const entry of entries) {
    lines.push(formatEntry(entry));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Rebuild the body after pruning, preserving all non-entry prose sections.
 *
 * Algorithm:
 * 1. Split original body into sections (existing `parseSections` gives us heading→content)
 * 2. For each section, check if it's an entry-backed structured section (has a known type)
 *    - If YES: rewrite it from the filtered entries for that type
 *    - If NO: keep it verbatim (Overview, Detection, prose, examples, etc.)
 * 3. Rebuild body in original order, skipping empty entry sections
 *
 * This ensures that interactive-skill markdown retains narrative content (## Overview,
 * ## Detection, free-form notes) while only pruned-entry sections are regenerated.
 */
function rebuildBodyPreservingSections(
  originalBody: string,
  originalSections: Record<string, string>,
  filteredEntries: KnowledgeEntry[],
): string {
  // groupEntriesByHeading returns: { "Stable Selectors": [...entries...] }
  // This matches the heading names used in originalSections.
  const byHeading = groupEntriesByHeading(filteredEntries);

  // We need to know which headings correspond to which entry types.
  // Reverse ENTRY_TYPE_MAP: type → canonical heading
  const typeToHeading: Partial<Record<EntryType, string>> = {};
  for (const [heading, type] of Object.entries(ENTRY_TYPE_MAP)) {
    if (!typeToHeading[type as EntryType]) {
      typeToHeading[type as EntryType] = heading;
    }
  }

  const lines: string[] = [];
  const processedTypes = new Set<EntryType>();

  // Walk through sections in original order
  for (const [heading, content] of Object.entries(originalSections)) {
    // Check if this heading has filtered entries (byHeading uses canonical heading names).
    // Use exact heading match (case-insensitive) against the grouped entries.
    const headingLower = heading.toLowerCase();
    const matchingHeading = Object.keys(byHeading).find(
      (h) => h.toLowerCase() === headingLower,
    );

    // Classify by section semantics, not just content format.
    // A section is entry-backed ONLY if both conditions hold:
    //   1. The heading maps to a known structured entry type (guessEntryType)
    //   2. The section content contains list items (starts with "-")
    // Prose bullet lists under non-entry headings (Overview, Detection, etc.)
    // must be preserved verbatim even though they start with "-".
    const isEntrySection = guessEntryType(heading) !== null && content.trim().startsWith("-");

    if (isEntrySection) {
      // Entry-backed section — only include if it has matching filtered entries.
      // If matchingHeading has no entries (all pruned), skip this section entirely.
      if (matchingHeading && byHeading[matchingHeading]!.length > 0) {
        lines.push(rebuildSection(heading, byHeading[matchingHeading]!));
        const type = guessEntryType(heading);
        if (type) processedTypes.add(type);
      }
      // else: no matching entries → skip (don't fall through to prose branch)
    } else {
      // Non-entry prose section — preserve verbatim.
      if (content.trim()) {
        lines.push(`## ${heading}`);
        lines.push(content);
        lines.push("");
      } else {
        lines.push(`## ${heading}`);
        lines.push("");
      }
    }
  }

  // Append any entry sections that exist in byHeading but weren't in original body
  for (const [heading, sectionEntries] of Object.entries(byHeading)) {
    // Skip headings already processed
    const type = guessEntryType(heading);
    if (type && processedTypes.has(type)) continue;
    if (sectionEntries.length === 0) continue;
    lines.push(rebuildSection(heading, sectionEntries));
  }

  return lines.join("\n").trim();
}

/**
 * Legacy rebuildBody for backward compatibility — kept minimal.
 */
function rebuildBody(_originalBody: string, entries: KnowledgeEntry[]): string {
  const byHeading = groupEntriesByHeading(entries);
  const lines: string[] = [];
  for (const [section, sectionEntries] of Object.entries(byHeading)) {
    lines.push(rebuildSection(section, sectionEntries));
  }
  return lines.join("\n").trim();
}

function getSectionHeadingForType(type: EntryType): string {
  const map: Record<EntryType, string> = {
    "stable-selector": "Stable Selectors",
    "pitfall": "Pitfalls",
    "wait-condition": "Wait Conditions",
    "navigation-shortcut": "Navigation Shortcuts",
    "api-endpoint": "API Endpoints",
    "dom-quirk": "DOM Quirks",
  };
  return map[type] ?? "Other";
}

// ── Pruning (Section 9 Fix) ─────────────────────────────────────────

interface PruneOptions {
  /** Remove entries older than this many days */
  maxAgeDays?: number;
  /** Remove unverified entries */
  removeUnverified?: boolean;
  /** Remove entries with failed status */
  removeFailed?: boolean;
}

interface PruneResult {
  removed: number;
  kept: number;
  filePath: string;
}

/**
 * Prune stale entries from a knowledge artifact.
 * Returns how many entries were removed vs kept.
 * Does NOT delete the file — use deleteArtifact() for that.
 */
export function pruneArtifact(
  filePath: string,
  options: PruneOptions = {},
): PruneResult {
  const artifact = loadArtifact(filePath);
  if (!artifact) {
    throw new Error(`Cannot prune: artifact not found at ${filePath}`);
  }

  const { maxAgeDays = 90, removeUnverified = false, removeFailed = true } = options;
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const originalCount = artifact.entries.length;

  const filtered = artifact.entries.filter((entry) => {
    // Age check: use lastVerified if present AND valid (parseable to a real date),
    // otherwise fall back to capturedAt.
    // NOTE: Date-only formats like "2026-04-20" are valid in modern Node.js but
    // we check explicitly to avoid edge cases. If lastVerified is absent or
    // unparseable, use capturedAt from the entry.
    const lastVerifiedMs = entry.lastVerified ? new Date(entry.lastVerified).getTime() : NaN;
    const useLastVerified = !Number.isNaN(lastVerifiedMs);
    const effectiveDateMs = useLastVerified ? lastVerifiedMs : new Date(entry.capturedAt).getTime();

    // Age check: verified entries are "known good" and never expire by age alone.
    // Unverified entries are pruned if their effective date is older than cutoff.
    // This is the primary pruning mechanism.
    if (entry.verified) {
      // Verified entries: never remove by age (they're proven good).
      return true;
    }

    // Unverified entry: check age first (primary mechanism).
    if (effectiveDateMs < cutoffMs) {
      return false; // Too old, remove
    }

    // Recent but unverified: only remove if removeUnverified is set.
    // This is the secondary "safety net" mechanism, not the primary filter.
    if (removeUnverified) return false;

    // Remove entries with failed status if option set.
    if (removeFailed && (entry as any).failed === true) return false;

    return true;
  });

  const removed = originalCount - filtered.length;

  if (removed > 0) {
    // Rebuild body while preserving all non-entry prose sections
    const body = rebuildBodyPreservingSections(artifact.body, artifact.sections, filtered);
    saveArtifact(
      artifact.frontmatter.kind,
      artifact.frontmatter.kind === "domain-skill"
        ? (artifact.frontmatter.domain ?? "unknown")
        : (artifact.frontmatter.name ?? "unknown"),
      artifact.frontmatter,
      body,
    );
  }

  return { removed, kept: filtered.length, filePath };
}
